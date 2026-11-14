import "dotenv/config";
import { io } from "socket.io-client";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const url = (process.env.LOAD_TEST_URL || "http://localhost:5000").replace(/\/$/, "");
const rl = createInterface({ input: stdin, output: stdout });
const clients = [];
const stats = {
  joined: 0,
  joinFailed: 0,
  questionsSeen: 0,
  answerAttempts: 0,
  accepted: 0,
  rejected: 0,
  errors: 0,
  latencies: [],
};
let stopping = false;

const ask = async (question) => (await rl.question(question)).trim();
const ack = (socket, event, payload, timeout = 15000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(event + " acknowledgement timed out")), timeout);
    const callback = (response) => {
      clearTimeout(timer);
      resolve(response || {});
    };
    if (payload === undefined) socket.emit(event, callback);
    else socket.emit(event, payload, callback);
  });

const connect = () =>
  new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 10000,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) => {
      socket.disconnect();
      reject(error);
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function printSummary() {
  const sorted = [...stats.latencies].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0;
  console.log("\nCLOUD CLASH MANUAL ROOM TEST");
  console.log("----------------------------");
  console.log("Participants joined: " + stats.joined);
  console.log("Join failures:       " + stats.joinFailed);
  console.log("Questions received:  " + stats.questionsSeen);
  console.log("Answer attempts:     " + stats.answerAttempts);
  console.log("Accepted answers:    " + stats.accepted);
  console.log("Rejected answers:    " + stats.rejected);
  console.log("Answer errors:       " + stats.errors);
  console.log("Ack latency p50:     " + percentile(0.5).toFixed(1) + " ms");
  console.log("Ack latency p95:     " + percentile(0.95).toFixed(1) + " ms");
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clients.forEach((socket) => socket.disconnect());
  printSummary();
  rl.close();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

try {
  console.log("\nCloud Clash — Manual Room Participant Simulator");
  console.log("Make sure the backend is running and you have created a room in the host dashboard.\n");

  const roomCode = (await ask("Room code: ")).toUpperCase();
  if (!roomCode) throw new Error("Room code is required.");

  const rawCount = await ask("Number of simulated participants (1–500): ");
  const count = Number(rawCount);
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    throw new Error("Participant count must be an integer between 1 and 500.");
  }

  const health = await fetch(url + "/health");
  if (!health.ok) throw new Error("Backend health check failed: " + health.status);

  console.log("\nConnecting " + count + " simulated participants to " + url + "...");
  for (let i = 1; i <= count; i++) {
    try {
      const socket = await connect();
      const name = "Load Tester " + String(i).padStart(3, "0") + "-" + Math.random().toString(36).slice(2, 6);
      const joined = await ack(socket, "join_competition", { name, code: roomCode });

      if (!joined.success) {
        stats.joinFailed++;
        console.log("✗ " + name + ": " + (joined.message || "join rejected"));
        socket.disconnect();
        continue;
      }

      socket.participantId = joined.participant.id;
      socket.displayName = name;
      clients.push(socket);
      stats.joined++;

      socket.on("question_started", (question) => {
        if (stopping || joined.snapshot?.eliminated) return;
        stats.questionsSeen++;
        // Randomized response timing spreads traffic across the question window.
        const delay = 150 + Math.floor(Math.random() * 1000);
        setTimeout(async () => {
          if (stopping || !socket.connected) return;
          stats.answerAttempts++;
          const startedAt = performance.now();
          try {
            const response = await ack(socket, "submit_answer", {
              participantId: socket.participantId,
              questionNumber: question.questionNumber,
              selectedOption: Math.floor(Math.random() * 4),
            });
            stats.latencies.push(performance.now() - startedAt);
            if (response.success && response.accepted) stats.accepted++;
            else {
              stats.rejected++;
              if (response.message?.includes("eliminated")) {
                console.log("↳ " + socket.displayName + " is eliminated; answer correctly rejected.");
              }
            }
          } catch (error) {
            stats.errors++;
            console.log("Answer error for " + socket.displayName + ": " + error.message);
          }
        }, delay);
      });

      socket.on("round_finished", (data) => {
        console.log("\nRound " + data.round + " finished. Waiting for host to review/confirm eliminations...");
      });
      socket.on("eliminations_confirmed", (data) => {
        if (data.eliminatedIds?.includes(socket.participantId)) {
          console.log("↳ " + socket.displayName + " has been eliminated and will remain connected as a spectator.");
        }
      });
      socket.on("disconnect", (reason) => {
        if (!stopping) console.log("⚠ " + socket.displayName + " disconnected: " + reason);
      });

      if (stats.joined % 10 === 0 || stats.joined === count) {
        console.log("Joined " + stats.joined + "/" + count);
      }
    } catch (error) {
      stats.joinFailed++;
      console.log("✗ Participant " + i + " failed to connect: " + error.message);
    }
    // Avoid a sudden connection spike against the event server.
    if (i < count) await sleep(40);
  }

  console.log("\nReady. " + stats.joined + "/" + count + " participants joined room " + roomCode + ".");
  console.log("Start the quiz from the host dashboard. Simulated participants will answer automatically.");
  console.log("Eliminated participants stay connected but cannot answer further questions.");
  console.log("Press Ctrl+C here when the test is over to print the report and disconnect all simulated players.\n");

  // Keep the process alive while Socket.IO clients participate in the host-controlled quiz.
  await new Promise(() => {});
} catch (error) {
  console.error("\nMANUAL ROOM TEST FAILED:", error.message);
  clients.forEach((socket) => socket.disconnect());
  rl.close();
  process.exitCode = 1;
}
