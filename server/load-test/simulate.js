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
const startedRounds = new Set();
const roundMetrics = new Map();
let quizFinished = false;
let completionTimer = null;
const stats = {
  requested: 50,
  joined: 0,
  joinFailed: 0,
  questionsSeen: 0,
  answerAttempts: 0,
  skippedAnswers: 0,
  correctGuessCount: 0,
  wrongGuessCount: 0,
  accepted: 0,
  rejected: 0,
  eliminatedAnswerAttempts: 0,
  eliminatedAnswerRejected: 0,
  eliminatedAnswerAccepted: 0,
  errors: 0,
  unexpectedDisconnects: 0,
  reconnections: 0,
  intentionalDisconnects: 0,
  randomDisconnects: 0,
  randomDisconnectRecoveries: 0,
  reconnectAttempts: 0,
  sessionRecoverySuccesses: 0,
  sessionRecoveryFailures: 0,
  sessionIdMismatches: 0,
  eliminationsConfirmed: 0,
  latencies: [],
};
let stopping = false;
let disconnectTestStarted = false;
const randomDropScheduled = new Set();
let url = "";

const ask = async (question) => (await rl.question(question)).trim();
const metricsForRound = (round) => {
  if (!roundMetrics.has(round)) roundMetrics.set(round, { uniqueQuestions: new Set(), questionEvents: 0, answerAttempts: 0, skippedAnswers: 0, accepted: 0, rejected: 0, errors: 0 });
  return roundMetrics.get(round);
};
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
  console.log("\n========== CLOUD CLASH SOCKET.IO LOAD TEST ==========");
  console.log("Backend URL:                    " + url);
  console.log("Requested participants:         " + stats.requested);
  console.log("Successfully joined:            " + stats.joined);
  console.log("Join failures:                  " + stats.joinFailed);
  console.log("Disconnect events:               " + stats.unexpectedDisconnects);
  console.log("Socket reconnections:             " + stats.reconnections);
  console.log("Intentional test disconnects:     " + stats.intentionalDisconnects);
  console.log("Additional random disconnects:    " + stats.randomDisconnects);
  console.log("Random disconnect recoveries:    " + stats.randomDisconnectRecoveries);
  console.log("Skipped answer decisions:        " + stats.skippedAnswers);
  console.log("Participant recovery attempts:    " + stats.reconnectAttempts);
  console.log("Participant recoveries passed:   " + stats.sessionRecoverySuccesses);
  console.log("Participant recoveries failed:   " + stats.sessionRecoveryFailures);
  console.log("Participant ID mismatches:       " + stats.sessionIdMismatches);
  console.log("Question events received:       " + stats.questionsSeen);
  console.log("Answer attempts:                " + stats.answerAttempts);
  console.log("Skipped answer decisions:        " + stats.skippedAnswers);
  console.log("Accepted answers:               " + stats.accepted);
  console.log("Rejected answers:               " + stats.rejected);
  console.log("Answer acknowledgement errors:  " + stats.errors);
  console.log("Confirmed eliminated players:   " + stats.eliminationsConfirmed);
  console.log("Post-elimination attempts:       " + stats.eliminatedAnswerAttempts);
  console.log("Post-elimination rejected:       " + stats.eliminatedAnswerRejected);
  console.log("Post-elimination accepted:      " + stats.eliminatedAnswerAccepted);
  console.log("Answer ack latency p50:         " + percentile(stats.latencies, 0.5).toFixed(1) + " ms");
  console.log("Answer ack latency p95:         " + percentile(stats.latencies, 0.95).toFixed(1) + " ms");
  console.log("Rounds started:                 " + [...startedRounds].sort((a, b) => a - b).join(", "));
  console.log("Rounds completed:               " + [...finishedRounds].sort((a, b) => a - b).join(", "));
  console.log("Quiz completion detected:       " + (quizFinished ? "YES" : "NO — interrupted or still running"));
  console.log("\nPer-round breakdown:");
  console.log("Round | Questions | Bot events | Attempts | Skipped | Accepted | Rejected | Errors");
  for (const [round, metric] of [...roundMetrics.entries()].sort((a, b) => a[0] - b[0])) console.log(String(round).padStart(5) + " | " + String(metric.uniqueQuestions.size).padStart(9) + " | " + String(metric.questionEvents).padStart(10) + " | " + String(metric.answerAttempts).padStart(8) + " | " + String(metric.skippedAnswers).padStart(7) + " | " + String(metric.accepted).padStart(8) + " | " + String(metric.rejected).padStart(8) + " | " + metric.errors);
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
  console.log("This creates simulated participant connections to the backend and room you specify.");
  console.log("Create the room in the deployed host dashboard first. Enable elimination in Advanced Configuration.");
  console.log("For a meaningful elimination test, configure a keep-count after Round 1 (for example, keep top 20).\n");

  const configuredUrl = (process.env.LOAD_TEST_URL || "").trim();
  url = (await ask("Deployed backend URL" + (configuredUrl ? " [" + configuredUrl + "]" : "") + ": ")) || configuredUrl;
  url = url.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(url)) throw new Error("Enter the full backend URL, including https://.");
  if (/localhost|127\.0\.0\.1/i.test(url)) throw new Error("This script is intended for the deployed backend. Localhost URL refused.");

  const roomCode = (await ask("Room code: " )).toUpperCase();
  if (!roomCode) throw new Error("Room code is required.");

  const envCount = Number(process.env.LOAD_TEST_PARTICIPANTS || 50);
  const defaultCount = Number.isInteger(envCount) && envCount >= 1 && envCount <= 50 ? envCount : 50;
  const rawCount = await ask("Simulated bot participants (1–50) [" + defaultCount + "]: ");
  const count = rawCount ? Number(rawCount) : defaultCount;
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error("Bot participant count must be an integer between 1 and 50. ");
  }
  stats.requested = count;

  const rawDisconnectCount = await ask("Participants to intentionally disconnect/reconnect after the first question [5]: ");
  const disconnectCount = rawDisconnectCount ? Number(rawDisconnectCount) : 5;
  if (!Number.isInteger(disconnectCount) || disconnectCount < 0 || disconnectCount > count) throw new Error("Disconnect count must be between 0 and the participant count.");

  console.log("\nTarget: " + url);
  console.log("Room:   " + roomCode);
  console.log("Load:   " + count + " simulated participants");
  const confirmation = await ask("\nThis will open real connections to this deployed service. Type RUN to continue: ");
  if (confirmation !== "RUN") throw new Error("Test cancelled.");

  const healthResponse = await fetch(url + "/health", { signal: AbortSignal.timeout(15000) });
  const healthBody = await healthResponse.json().catch(() => ({}));
  console.log("\nHealth check: HTTP " + healthResponse.status + " — " + (healthBody.status || "unknown"));
  if (!healthResponse.ok || healthBody.status !== "ok") {
    throw new Error("Backend health check is not healthy. Check Render /health and persistence before load testing.");
  }
  if (healthBody.competition !== "waiting") {
    throw new Error("The selected room must be in WAITING state before bots join. Current backend competition state: " + (healthBody.competition || "unknown"));
  }

  console.log("\nConnecting " + count + " simulated participants...");
  console.log("You can also join this same room from your own phones/browsers; those are additional real participants beyond the bot count.");
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
        stats.reconnectAttempts++;
        try {
          const restored = await ack(socket, "join_competition", {
            name: socket.displayName, code: roomCode, participantId: socket.participantId,
          });
          if (!restored.success) {
            stats.sessionRecoveryFailures++;
            console.log("✗ " + socket.displayName + " session recovery rejected: " + (restored.message || "rejected"));
            return;
          }
          if (restored.participant?.id !== socket.participantId) {
            stats.sessionIdMismatches++; stats.sessionRecoveryFailures++;
            console.log("✗ " + socket.displayName + " rejoined with a different participant ID.");
            return;
          }
          stats.sessionRecoverySuccesses++;
          if (randomDropScheduled.has(socket.participantId)) stats.randomDisconnectRecoveries++;
          if (restored.snapshot?.eliminated) eliminatedIds.add(socket.participantId);
          console.log("↻ " + socket.displayName + " restored the same participant session.");
        } catch (error) {
          stats.sessionRecoveryFailures++;
          console.log("⚠ Rejoin failed for " + socket.displayName + ": " + error.message);
        }
      });

      socket.on("round_started", (data) => {
        if (startedRounds.has(data.round)) return;
        startedRounds.add(data.round);
        metricsForRound(data.round);
        console.log("\n▶ Round " + data.round + " started (" + (data.totalQuestions ?? "?") + " questions).");
      });

      socket.on("question_started", (question) => {
        if (stopping) return;
        const roundMetric = metricsForRound(question.round);
        roundMetric.questionEvents++;
        roundMetric.uniqueQuestions.add(String(question.round) + ":" + String(question.questionNumber));
        stats.questionsSeen++;
        if (question.round === 1 && question.questionNumber === 1 && disconnectCount > 0 && !disconnectTestStarted) {
          disconnectTestStarted = true;
          const targets = clients.filter((client) => client.connected).slice(0, disconnectCount);
          console.log("\nStarting controlled reconnect test for " + targets.length + " participants...");
          targets.forEach((client, index) => setTimeout(() => {
            if (stopping || !client.connected) return;
            stats.intentionalDisconnects++;
            console.log("⤫ Forcing test disconnect: " + client.displayName);
            client.disconnect();
            setTimeout(() => { if (!stopping) client.connect(); }, 1200);
          }, index * 250));
        }
        // Each bot behaves differently: some skip, others answer after a randomized
        // think-time. This is client-side pacing, not actual network packet shaping.
        const wasEliminatedAtQuestionStart = eliminatedIds.has(socket.participantId);
        const skipProbability = 0.12;
        const answerProbability = Math.random();
        if (answerProbability < skipProbability) {
          stats.skippedAnswers++;
          roundMetric.skippedAnswers++;
        } else {
          const remainingMs = Number.isFinite(question.endsAt)
            ? Math.max(500, question.endsAt - Date.now() - 250)
            : 8000;
          const delay = 350 + Math.floor(Math.random() * Math.max(1, Math.min(remainingMs - 350, 8500)));
          setTimeout(async () => {
            if (stopping || !socket.connected) return;
            stats.answerAttempts++;
            roundMetric.answerAttempts++;
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
                roundMetric.accepted++;
                if (wasEliminatedAtQuestionStart) stats.eliminatedAnswerAccepted++;
              } else {
                stats.rejected++;
                roundMetric.rejected++;
                if (wasEliminatedAtQuestionStart) stats.eliminatedAnswerRejected++;
              }
            } catch (error) {
              stats.errors++;
              roundMetric.errors++;
              console.log("Answer error for " + socket.displayName + ": " + error.message);
            }
          }, delay);
        }

        // A small random subset experiences one extra temporary connection drop
        // during the quiz. Keep the original participant ID for recovery checks.
        if (
          question.round >= 1 &&
          question.questionNumber >= 2 &&
          !randomDropScheduled.has(socket.participantId) &&
          Math.random() < 0.008
        ) {
          randomDropScheduled.add(socket.participantId);
          const dropDelay = 500 + Math.floor(Math.random() * 4500);
          setTimeout(() => {
            if (stopping || !socket.connected) return;
            stats.randomDisconnects++;
            console.log("⤫ Random network interruption: " + socket.displayName);
            socket.disconnect();
            setTimeout(() => {
              if (!stopping) socket.connect();
            }, 1800 + Math.floor(Math.random() * 3200));
          }, dropDelay);
        }
      });

      socket.on("round_finished", (data) => {
        if (finishedRounds.has(data.round)) return;
        finishedRounds.add(data.round);
        console.log("\n✓ Round " + data.round + " finished. Waiting for the host to confirm eliminations (if enabled) and start the next round.");
      });

      socket.on("competition_finished", () => {
        if (quizFinished || stopping) return;
        quizFinished = true;
        console.log("\n🏁 QUIZ FINISHED event received from server. Collecting final acknowledgements...");
        if (completionTimer) clearTimeout(completionTimer);
        completionTimer = setTimeout(() => {
          if (stopping) return;
          stopping = true;
          clients.forEach((client) => client.disconnect());
          printSummary();
          rl.close();
          process.exit(0);
        }, 1500);
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
    // Ramp connections gradually instead of opening all 50 at once.
    if (i < count) await sleep(80 + Math.floor(Math.random() * 271));
  }

  console.log("\nReady: " + stats.joined + "/" + count + " joined room " + roomCode + ".");
  console.log("Now start the quiz from the deployed host dashboard.");
  console.log("At each round break, review and confirm eliminations on the host dashboard before starting the next round.");
  console.log("The simulator tests controlled recovery after Round 1 Question 1 plus occasional random mid-quiz disconnects.");
  console.log("Bots use randomized answer timing, occasional skipped answers, and staggered joins.");
  console.log("Recovery passes only when the original participant ID is returned.");
  console.log("The simulator also tests server-side rejection for eliminated participants.");
  console.log("The bot count is separate from physical devices joining manually.");
  console.log("Keep this terminal open until the quiz is finished. Press Ctrl+C to disconnect everyone and print the report.\n");

  await new Promise(() => {});
} catch (error) {
  console.error("\nDEPLOYED TEST FAILED:", error.message);
  clients.forEach((socket) => socket.disconnect());
  rl.close();
  process.exitCode = 1;
}
