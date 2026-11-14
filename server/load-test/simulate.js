import "dotenv/config";
import { io } from "socket.io-client";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const rl = createInterface({ input: stdin, output: stdout });
const clients = [];
const eliminatedIds = new Set();
const finishedRounds = new Set();
const confirmedRounds = new Set();
const stats = {
  requested: 40,
  joined: 0,
  joinFailed: 0,
  questionsSeen: 0,
  answerAttempts: 0,
  accepted: 0,
  rejected: 0,
  eliminatedAnswerAttempts: 0,
  eliminatedAnswerRejected: 0,
  eliminatedAnswerAccepted: 0,
  errors: 0,
  unexpectedDisconnects: 0,
  reconnections: 0,
  eliminationsConfirmed: 0,
  latencies: [],
};
let stopping = false;
let url = "";

const ask = async (question) => (await rl.question(question)).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      reconnectionDelay: 1000,
      timeout: 15000,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) => {
      socket.disconnect();
      reject(error);
    });
  });

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

function printSummary() {
  console.log("\n========== CLOUD CLASH DEPLOYED TEST ==========");
  console.log("Backend URL:                    " + url);
  console.log("Requested participants:         " + stats.requested);
  console.log("Successfully joined:            " + stats.joined);
  console.log("Join failures:                  " + stats.joinFailed);
  console.log("Disconnect events:               " + stats.unexpectedDisconnects);
  console.log("Successful reconnections:        " + stats.reconnections);
  console.log("Question events received:       " + stats.questionsSeen);
  console.log("Answer attempts:                " + stats.answerAttempts);
  console.log("Accepted answers:               " + stats.accepted);
  console.log("Rejected answers:               " + stats.rejected);
  console.log("Answer acknowledgement errors:  " + stats.errors);
  console.log("Confirmed eliminated players:   " + stats.eliminationsConfirmed);
  console.log("Post-elimination attempts:       " + stats.eliminatedAnswerAttempts);
  console.log("Post-elimination rejected:       " + stats.eliminatedAnswerRejected);
  console.log("Post-elimination accepted:      " + stats.eliminatedAnswerAccepted);
  console.log("Answer ack latency p50:         " + percentile(stats.latencies, 0.5).toFixed(1) + " ms");
  console.log("Answer ack latency p95:         " + percentile(stats.latencies, 0.95).toFixed(1) + " ms");
  console.log("Rounds observed:                " + [...finishedRounds].sort((a, b) => a - b).join(", "));
  console.log("================================================");
  if (stats.joined !== stats.requested) console.log("WARNING: Not all requested participants joined.");
  if (stats.eliminationsConfirmed === 0) console.log("NOTE: No elimination confirmation was observed. Check that elimination is enabled and the host confirmed candidates.");
  if (stats.eliminatedAnswerAccepted > 0) console.log("FAILURE: The backend accepted an answer from an eliminated participant.");
  else if (stats.eliminatedAnswerRejected > 0) console.log("PASS: The backend rejected answer attempts from eliminated participants.");
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
  console.log("\nCloud Clash — Deployed Manual-Room Simulator");
  console.log("This creates simulated participant connections to the backend you specify.");
  console.log("Create the room in the deployed host dashboard first. Enable elimination in Advanced Configuration.");
  console.log("For a meaningful elimination test, configure a keep-count after Round 1 (for example, keep top 20).\n");

  const configuredUrl = (process.env.LOAD_TEST_URL || "").trim();
  url = (await ask("Deployed backend URL" + (configuredUrl ? " [" + configuredUrl + "]" : "") + ": ")) || configuredUrl;
  url = url.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error("Enter the full backend URL, including https://.");
  if (/localhost|127\.0\.0\.1/i.test(url)) throw new Error("This script is intended for the deployed backend. Localhost URL refused.");

  const roomCode = (await ask("Room code: " )).toUpperCase();
  if (!roomCode) throw new Error("Room code is required.");

  const rawCount = await ask("Simulated participants (1–40) [40]: ");
  const count = rawCount ? Number(rawCount) : 40;
  if (!Number.isInteger(count) || count < 1 || count > 40) {
    throw new Error("Participant count must be an integer between 1 and 40.");
  }
  stats.requested = count;

  console.log("\nTarget: " + url);
  console.log("Room:   " + roomCode);
  console.log("Load:   " + count + " simulated participants");
  const confirmation = await ask("\nThis will open real connections to this deployed service. Type RUN to continue: ");
  if (confirmation !== "RUN") throw new Error("Test cancelled.");

  const healthResponse = await fetch(url + "/health", { signal: AbortSignal.timeout(15000) });
  const healthBody = await healthResponse.json().catch(() => ({}));
  console.log("\nHealth check: HTTP " + healthResponse.status + " — " + (healthBody.status || "unknown"));
  if (!healthResponse.ok) {
    throw new Error("Backend health check is not healthy. Check Render /health and persistence before load testing.");
  }

  console.log("\nConnecting " + count + " simulated participants...");
  for (let i = 1; i <= count; i++) {
    try {
      const socket = await connect();
      const name = "Load Tester " + String(i).padStart(2, "0") + "-" + Math.random().toString(36).slice(2, 6);
      const joined = await ack(socket, "join_competition", { name, code: roomCode });

      if (!joined.success) {
        stats.joinFailed++;
        console.log("✗ " + name + ": " + (joined.message || "join rejected"));
        socket.disconnect();
        continue;
      }

      socket.participantId = joined.participant.id;
      socket.displayName = name;
      socket.hasJoinedRoom = true;
      clients.push(socket);
      stats.joined++;

      // Socket.IO reconnects create a fresh server-side socket. Rejoin with the
      // original participant ID so the server restores the same participant.
      socket.on("connect", async () => {
        if (!socket.hasJoinedRoom || stopping) return;
        stats.reconnections++;
        try {
          const restored = await ack(socket, "join_competition", {
            name: socket.displayName,
            code: roomCode,
            participantId: socket.participantId,
          });
          if (!restored.success) {
            console.log("✗ " + socket.displayName + " could not rejoin: " + (restored.message || "rejected"));
            return;
          }
          if (restored.snapshot?.eliminated) eliminatedIds.add(socket.participantId);
          console.log("↻ " + socket.displayName + " rejoined successfully.");
        } catch (error) {
          console.log("⚠ Rejoin failed for " + socket.displayName + ": " + error.message);
        }
      });

      socket.on("question_started", (question) => {
        if (stopping) return;
        stats.questionsSeen++;
        // Keep eliminated sockets active and deliberately submit answers. The server must reject them.
        const wasEliminatedAtQuestionStart = eliminatedIds.has(socket.participantId);
        const delay = 200 + Math.floor(Math.random() * 900);
        setTimeout(async () => {
          if (stopping || !socket.connected) return;
          stats.answerAttempts++;
          if (wasEliminatedAtQuestionStart) stats.eliminatedAnswerAttempts++;
          const startedAt = performance.now();
          try {
            const response = await ack(socket, "submit_answer", {
              participantId: socket.participantId,
              questionNumber: question.questionNumber,
              selectedOption: Math.floor(Math.random() * 4),
            });
            stats.latencies.push(performance.now() - startedAt);
            if (response.success && response.accepted) {
              stats.accepted++;
              if (wasEliminatedAtQuestionStart) stats.eliminatedAnswerAccepted++;
            } else {
              stats.rejected++;
              if (wasEliminatedAtQuestionStart) stats.eliminatedAnswerRejected++;
            }
          } catch (error) {
            stats.errors++;
            console.log("Answer error for " + socket.displayName + ": " + error.message);
          }
        }, delay);
      });

      socket.on("round_finished", (data) => {
        if (finishedRounds.has(data.round)) return;
        finishedRounds.add(data.round);
        console.log("\n✓ Round " + data.round + " finished. Host can review elimination candidates and confirm them.");
        if (!data.eliminationsConfirmed) {
          console.log("  Pending elimination review detected. Waiting for host confirmation...");
        } else {
          console.log("  No pending eliminations for this round.");
        }
      });

      socket.on("eliminations_confirmed", (data) => {
        const ids = data.eliminatedIds || [];
        if (!confirmedRounds.has(data.round)) confirmedRounds.add(data.round);
        for (const id of ids) eliminatedIds.add(id);
        stats.eliminationsConfirmed = eliminatedIds.size;
        if (ids.includes(socket.participantId)) {
          console.log("↳ " + socket.displayName + " marked eliminated; remaining connected as spectator.");
        }
      });

      socket.on("disconnect", (reason) => {
        if (!stopping) {
          stats.unexpectedDisconnects++;
          console.log("⚠ " + socket.displayName + " disconnected: " + reason);
        }
      });

      if (stats.joined % 10 === 0 || stats.joined === count) {
        console.log("Joined " + stats.joined + "/" + count);
      }
    } catch (error) {
      stats.joinFailed++;
      console.log("✗ Participant " + i + " failed: " + error.message);
    }
    // Ramp connections gradually instead of opening all 40 at once.
    if (i < count) await sleep(100);
  }

  console.log("\nReady: " + stats.joined + "/" + count + " joined room " + roomCode + ".");
  console.log("Now start the quiz from the deployed host dashboard.");
  console.log("At each round break, review and confirm eliminations on the host dashboard before starting the next round.");
  console.log("The simulator intentionally keeps eliminated clients connected and attempts answers to verify server-side rejection.");
  console.log("Keep this terminal open until the quiz is finished. Press Ctrl+C to disconnect everyone and print the report.\n");

  await new Promise(() => {});
} catch (error) {
  console.error("\nDEPLOYED TEST FAILED:", error.message);
  clients.forEach((socket) => socket.disconnect());
  rl.close();
  process.exitCode = 1;
}
