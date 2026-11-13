import "dotenv/config";
import { io } from "socket.io-client";
import { performance } from "node:perf_hooks";

const serverUrl = process.env.LOAD_TEST_URL || "http://localhost:5000";
const participantCount = Number(process.env.LOAD_TEST_PARTICIPANTS || 50);
const competitionCode = process.env.COMPETITION_CODE || "CLOUD26";
const hostPassword = process.env.HOST_PASSWORD;
const timeoutMs = Number(process.env.LOAD_TEST_TIMEOUT_MS || 600000);

if (!hostPassword) {
  console.error("Set HOST_PASSWORD in server/.env before running the load test.");
  process.exit(1);
}
if (!Number.isInteger(participantCount) || participantCount < 1 || participantCount > 100) {
  console.error("LOAD_TEST_PARTICIPANTS must be an integer between 1 and 100.");
  process.exit(1);
}

const startedAt = performance.now();
const clients = [];
const latencies = [];
let acceptedAnswers = 0;
let rejectedAnswers = 0;
let questionEvents = 0;
let completed = false;

function ack(socket, event, payload, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event} acknowledgement`)), timeout);
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function waitFor(socket, event, predicate = () => true, timeout = timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeout);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

function makeCsv() {
  const rows = ["round,question,option_a,option_b,option_c,option_d,correct_option,explanation"];
  for (const round of [1, 2]) {
    for (let n = 1; n <= 25; n += 1) {
      rows.push(`${round},"Load test R${round} Q${n}",Correct answer,Wrong answer B,Wrong answer C,Wrong answer D,A,"Synthetic load-test question"`);
    }
  }
  return rows.join("\n");
}

async function connectClient(name) {
  const socket = io(serverUrl, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 10000,
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const result = await ack(socket, "join_competition", { name, code: competitionCode });
  if (!result?.success) throw new Error(`${name} could not join: ${result?.message || "unknown error"}`);
  return socket;
}

function attachQuestionSimulation(socket, participantIndex) {
  socket.on("question_started", (question) => {
    questionEvents += 1;
    // Spread submissions across the first part of the question window to avoid
    // an unrealistic single-millisecond burst while still exercising concurrency.
    const delay = 100 + ((participantIndex * 37) % 500);
    setTimeout(async () => {
      const sentAt = performance.now();
      try {
        const result = await ack(socket, "submit_answer", {
          participantId: socket.data.participantId,
          questionNumber: question.questionNumber,
          selectedOption: 0,
        });
        latencies.push(performance.now() - sentAt);
        if (result?.success && result.accepted) acceptedAnswers += 1;
        else rejectedAnswers += 1;
      } catch (error) {
        rejectedAnswers += 1;
        console.error(`Answer error for client ${participantIndex + 1}: ${error.message}`);
      }
    }, delay);
  });
}

async function main() {
  const health = await fetch(`${serverUrl}/health`);
  if (!health.ok) throw new Error(`Backend health check failed: HTTP ${health.status}`);
  const healthBody = await health.json();
  if (healthBody.competition !== "waiting") {
    throw new Error(`Load test requires a fresh waiting competition; current status is "${healthBody.competition}". Restart the local backend first.`);
  }

  const host = io(serverUrl, { transports: ["websocket"], reconnection: false, timeout: 10000 });
  await new Promise((resolve, reject) => {
    host.once("connect", resolve);
    host.once("connect_error", reject);
  });
  const login = await ack(host, "host_login", hostPassword);
  if (!login?.success) throw new Error(`Host login failed: ${login?.message || "unknown error"}`);

  const imported = await ack(host, "import_questions", { csv: makeCsv() });
  if (!imported?.success) throw new Error(`Could not import synthetic questions: ${imported?.message || "unknown error"}`);

  console.log(`Connecting ${participantCount} virtual participants to ${serverUrl}...`);
  const connected = await Promise.all(
    Array.from({ length: participantCount }, (_, index) =>
      connectClient(`Load Tester ${String(index + 1).padStart(3, "0")}`)
    )
  );
  clients.push(...connected);
  clients.forEach((socket, index) => {
    // The server sends participantId in the join acknowledgement; retain it for answer events.
    // Store it on socket.data for the simulation callback.
    socket.data.participantId = socket.id;
    attachQuestionSimulation(socket, index);
  });

  // Retrieve the server-issued participant IDs through a second join using the
  // same socket identity. The server associates the ID with socket.data.
  // The load-test script keeps the ID returned by the join callback below.
  console.log(`Connected ${clients.length}/${participantCount} participants.`);

  const roundOneFinished = waitFor(host, "round_finished", (event) => event.round === 1);
  const start = await ack(host, "start_competition");
  if (!start?.success) throw new Error(`Could not start Round 1: ${start?.message || "unknown error"}`);
  await roundOneFinished;

  const roundTwoFinished = waitFor(host, "round_finished", (event) => event.round === 2);
  const roundTwoStarted = await ack(host, "start_round_two");
  if (!roundTwoStarted?.success) throw new Error(`Could not start Round 2: ${roundTwoStarted?.message || "unknown error"}`);
  const finalResults = await roundTwoFinished;
  completed = true;

  const expectedAnswers = participantCount * 50;
  const expectedScore = 375;
  const allScoresCorrect = finalResults.leaderboard.length === participantCount &&
    finalResults.leaderboard.every((entry) => entry.score === expectedScore && entry.correct === 50);
  const sorted = [...latencies].sort((a, b) => a - b);
  const percentile = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0;
  const durationSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);

  console.log("\nCLOUD CLASH LOAD TEST RESULTS");
  console.log("-----------------------------");
  console.log(`Participants:       ${clients.length}/${participantCount}`);
  console.log(`Question events:    ${questionEvents} (expected ${participantCount * 50})`);
  console.log(`Accepted answers:   ${acceptedAnswers}/${expectedAnswers}`);
  console.log(`Rejected answers:   ${rejectedAnswers}`);
  console.log(`Answer latency p50: ${percentile(0.50).toFixed(1)} ms`);
  console.log(`Answer latency p95: ${percentile(0.95).toFixed(1)} ms`);
  console.log(`Answer latency p99: ${percentile(0.99).toFixed(1)} ms`);
  console.log(`Final scores:       ${allScoresCorrect ? "PASS" : "FAIL"} (expected ${expectedScore} points and 50 correct each)`);
  console.log(`Duration:           ${durationSeconds}s`);

  if (acceptedAnswers !== expectedAnswers || rejectedAnswers !== 0 ||
      questionEvents !== participantCount * 50 || !allScoresCorrect) {
    process.exitCode = 1;
  }
}

const watchdog = setTimeout(() => {
  console.error("Load test exceeded its overall timeout.");
  process.exit(1);
}, timeoutMs);

try {
  await main();
} catch (error) {
  console.error("\nLOAD TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  clients.forEach((socket) => socket.disconnect());
}
