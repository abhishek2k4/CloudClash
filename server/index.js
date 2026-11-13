import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { Server } from "socket.io";
import { QUESTIONS as DEMO_QUESTIONS } from "./data/questions.js";

const app = express();
const httpServer = createServer(app);
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",").map((origin) => origin.trim());

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());
app.get("/health", (_req, res) => res.json({ status: "ok", service: "cloud-clash" }));

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
});

const CONFIG = {
  competitionCode: process.env.COMPETITION_CODE || "CLOUD26",
  hostPassword: process.env.HOST_PASSWORD,
  roundSeconds: {
    1: Number(process.env.ROUND_1_SECONDS || 20),
    2: Number(process.env.ROUND_2_SECONDS || 30),
  },
  marks: { 1: 5, 2: 10 },
};
if (!CONFIG.hostPassword) {
  console.warn("HOST_PASSWORD is not set. Host login is disabled until configured.");
}

let activeQuestions = { 1: [...DEMO_QUESTIONS[1]], 2: [...DEMO_QUESTIONS[2]] };
const participants = new Map();
let status = "waiting";
let currentRound = 0;
let questionIndex = -1;
let questionEndsAt = null;
let questionTimer = null;
let questionLocked = false;
let roundStartedAt = null;
const answers = new Map(); // key: round:questionIndex:participantId
const roundStats = new Map(); // participantId -> { correct, timeMs }
const totalStats = new Map(); // participantId -> { score, correct, timeMs }

const roundQuestions = (round) => activeQuestions[round] || [];

function parseCsv(source) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quotation mark.");
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function validateQuestionCsv(csvText) {
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("The CSV is empty. Add your questions below the header row.");
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const required = ["round", "question", "option_a", "option_b", "option_c", "option_d", "correct_option", "explanation"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}.`);
  const index = Object.fromEntries(required.map((header) => [header, headers.indexOf(header)]));
  const imported = { 1: [], 2: [] };
  const errors = [];

  rows.slice(1).forEach((row, offset) => {
    if (row.every((cell) => !cell.trim())) return;
    const line = offset + 2;
    const value = (key) => (row[index[key]] || "").trim();
    const round = Number(value("round"));
    if (![1, 2].includes(round)) { errors.push(`Row ${line}: round must be 1 or 2.`); return; }
    const text = value("question");
    const options = ["option_a", "option_b", "option_c", "option_d"].map(value);
    const correctRaw = value("correct_option").toUpperCase();
    const correctOption = ["A", "B", "C", "D"].indexOf(correctRaw) >= 0
      ? ["A", "B", "C", "D"].indexOf(correctRaw)
      : Number(correctRaw) - 1;
    if (!text) errors.push(`Row ${line}: question text is required.`);
    if (options.some((option) => !option)) errors.push(`Row ${line}: all four options are required.`);
    if (!Number.isInteger(correctOption) || correctOption < 0 || correctOption > 3) errors.push(`Row ${line}: correct_option must be A, B, C, D (or 1, 2, 3, 4).`);
    if (text && options.every(Boolean) && Number.isInteger(correctOption) && correctOption >= 0 && correctOption <= 3) {
      imported[round].push({ text, options, correctOption, explanation: value("explanation") });
    }
  });

  if (errors.length) throw new Error(errors.slice(0, 8).join("\n") + (errors.length > 8 ? `\nAnd ${errors.length - 8} more issue(s).` : ""));
  for (const round of [1, 2]) {
    if (imported[round].length !== 25) {
      throw new Error(`Round ${round} must contain exactly 25 questions. Found ${imported[round].length}.`);
    }
  }
  return imported;
}
const answerKey = (round, index, id) => `${round}:${index}:${id}`;
const publicParticipant = ({ id, name }) => ({ id, name });

function ensureStats(id) {
  if (!roundStats.has(id)) roundStats.set(id, { correct: 0, timeMs: 0 });
  if (!totalStats.has(id)) totalStats.set(id, { score: 0, correct: 0, timeMs: 0 });
}

function leaderboard(round = currentRound) {
  return [...participants.values()].map((person) => {
    const total = totalStats.get(person.id) || { score: 0, correct: 0, timeMs: 0 };
    const current = roundStats.get(person.id) || { correct: 0, timeMs: 0 };
    return {
      id: person.id,
      name: person.name,
      score: total.score,
      roundScore: round === 1 ? total.score : total.score - (person.roundOneScore || 0),
      correct: total.correct,
      roundCorrect: current.correct,
      timeMs: total.timeMs,
    };
  }).sort((a, b) =>
    b.score - a.score || b.correct - a.correct || a.timeMs - b.timeMs || a.name.localeCompare(b.name)
  ).map((entry, index) => ({ rank: index + 1, ...entry }));
}

function emitLobby() {
  const list = [...participants.values()].map(publicParticipant);
  io.to("host").emit("participants_updated", list);
  io.to("competition").emit("participants_updated", list);
}

function safeQuestion(question, index, round) {
  return {
    round,
    questionNumber: index + 1,
    totalQuestions: roundQuestions(round).length,
    text: question.text,
    options: question.options,
    endsAt: questionEndsAt,
    marks: CONFIG.marks[round],
  };
}

function startQuestion() {
  clearTimeout(questionTimer);
  const list = roundQuestions(currentRound);
  questionIndex += 1;

  if (questionIndex >= list.length) {
    finishRound();
    return;
  }

  questionLocked = false;
  questionEndsAt = Date.now() + CONFIG.roundSeconds[currentRound] * 1000;
  const question = safeQuestion(list[questionIndex], questionIndex, currentRound);
  io.to("competition").emit("question_started", question);
  io.to("host").emit("question_started", question);
  questionTimer = setTimeout(() => endQuestion("time"), CONFIG.roundSeconds[currentRound] * 1000);
}

function endQuestion(reason = "completed") {
  if (questionLocked || currentRound === 0 || questionIndex < 0) return;
  questionLocked = true;
  clearTimeout(questionTimer);
  const question = roundQuestions(currentRound)[questionIndex];
  io.to("competition").emit("question_ended", {
    round: currentRound,
    questionNumber: questionIndex + 1,
    correctOption: question.correctOption,
    explanation: question.explanation || "",
    reason,
  });
  io.to("host").emit("question_ended", {
    round: currentRound,
    questionNumber: questionIndex + 1,
    correctOption: question.correctOption,
    reason,
  });
  io.to("host").emit("leaderboard_updated", leaderboard());
  questionTimer = setTimeout(startQuestion, 2500);
}

function finishRound() {
  clearTimeout(questionTimer);
  questionLocked = true;
  questionEndsAt = null;
  const completedRound = currentRound;
  status = completedRound === 2 ? "finished" : "round_break";
  if (completedRound === 1) {
    for (const person of participants.values()) {
      person.roundOneScore = totalStats.get(person.id)?.score || 0;
    }
  }
  const results = leaderboard(completedRound);
  io.to("competition").emit("round_finished", { round: completedRound, leaderboard: results });
  io.to("host").emit("round_finished", { round: completedRound, leaderboard: results });
  io.to("host").emit("competition_status_updated", status);
  if (completedRound === 2) {
    io.to("competition").emit("competition_finished", { leaderboard: results });
    io.to("host").emit("competition_finished", { leaderboard: results });
  }
}

function startRound(round) {
  if (round !== 1 && round !== 2) return false;
  if (roundQuestions(round).length === 0) return false;
  currentRound = round;
  questionIndex = -1;
  questionEndsAt = null;
  questionLocked = true;
  roundStartedAt = Date.now();
  roundStats.clear();
  status = "running";
  for (const person of participants.values()) ensureStats(person.id);
  io.to("competition").emit("round_started", { round, totalQuestions: roundQuestions(round).length });
  io.to("host").emit("competition_status_updated", status);
  startQuestion();
  return true;
}

function snapshotForParticipant(id) {
  const base = {
    status,
    round: currentRound,
    leaderboard: leaderboard(),
    participants: [...participants.values()].map(publicParticipant),
  };
  if (status === "running" && questionIndex >= 0 && !questionLocked) {
    return { ...base, question: safeQuestion(roundQuestions(currentRound)[questionIndex], questionIndex, currentRound) };
  }
  return base;
}

io.on("connection", (socket) => {
  socket.on("join_competition", ({ name, code, participantId }, callback = () => {}) => {
    if (code !== CONFIG.competitionCode) return callback({ success: false, message: "Invalid competition code." });
    const cleanName = String(name || "").trim().slice(0, 40);
    if (!cleanName) return callback({ success: false, message: "Enter your name." });

    let participant = participantId && participants.get(participantId);
    if (!participant) {
      if (status !== "waiting") return callback({ success: false, message: "The competition has already started. New participants cannot join." });
      participant = { id: randomUUID(), name: cleanName, joinedAt: Date.now(), roundOneScore: 0 };
      participants.set(participant.id, participant);
      ensureStats(participant.id);
    } else {
      participant.name = cleanName;
    }

    socket.data.participantId = participant.id;
    socket.join("competition");
    callback({ success: true, participant: publicParticipant(participant), snapshot: snapshotForParticipant(participant.id) });
    emitLobby();
  });

  socket.on("host_login", (password, callback = () => {}) => {
    if (!CONFIG.hostPassword || password !== CONFIG.hostPassword) {
      return callback({ success: false, message: "Incorrect host password or HOST_PASSWORD is not configured." });
    }
    socket.join("host");
    callback({
      success: true,
      participants: [...participants.values()].map(publicParticipant),
      status,
      round: currentRound,
      question: status === "running" && questionIndex >= 0 && !questionLocked
        ? safeQuestion(roundQuestions(currentRound)[questionIndex], questionIndex, currentRound) : null,
      leaderboard: leaderboard(),
      roundSeconds: CONFIG.roundSeconds,
    });
  });

  socket.on("import_questions", ({ csv }, callback = () => {}) => {
    if (!socket.rooms.has("host")) return callback({ success: false, message: "Unauthorized." });
    if (status !== "waiting") return callback({ success: false, message: "Questions can only be imported before the competition starts." });
    if (typeof csv !== "string" || csv.length > 1_000_000) {
      return callback({ success: false, message: "Upload a CSV file smaller than 1 MB." });
    }
    try {
      const imported = validateQuestionCsv(csv);
      activeQuestions = imported;
      callback({ success: true, counts: { 1: imported[1].length, 2: imported[2].length } });
      console.log("Host imported 50 quiz questions.");
    } catch (error) {
      callback({ success: false, message: error.message });
    }
  });

  socket.on("start_competition", (callback = () => {}) => {
    if (!socket.rooms.has("host")) return callback({ success: false, message: "Unauthorized." });
    if (status !== "waiting") return callback({ success: false, message: "Competition has already started." });
    if (participants.size === 0) return callback({ success: false, message: "At least one participant must join first." });
    if (!startRound(1)) return callback({ success: false, message: "Round 1 has no questions configured." });
    callback({ success: true });
  });

  socket.on("start_round_two", (callback = () => {}) => {
    if (!socket.rooms.has("host")) return callback({ success: false, message: "Unauthorized." });
    if (status !== "round_break") return callback({ success: false, message: "Round 1 must finish before starting Round 2." });
    if (!startRound(2)) return callback({ success: false, message: "Round 2 has no questions configured." });
    callback({ success: true });
  });

  socket.on("submit_answer", ({ participantId, questionNumber, selectedOption }, callback = () => {}) => {
    const id = socket.data.participantId;
    if (!id || id !== participantId || !participants.has(id)) return callback({ success: false, message: "Join the competition first." });
    if (status !== "running" || questionLocked || Date.now() > questionEndsAt) return callback({ success: false, message: "Time is up. This answer was not counted." });
    if (questionNumber !== questionIndex + 1) return callback({ success: false, message: "This question is no longer active." });
    const question = roundQuestions(currentRound)[questionIndex];
    if (!Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption >= question.options.length) {
      return callback({ success: false, message: "Invalid option." });
    }
    const key = answerKey(currentRound, questionIndex, id);
    if (answers.has(key)) return callback({ success: false, message: "You have already submitted an answer." });

    const correct = selectedOption === question.correctOption;
    const elapsed = Math.max(0, Date.now() - (questionEndsAt - CONFIG.roundSeconds[currentRound] * 1000));
    answers.set(key, { selectedOption, correct, elapsed });
    if (correct) {
      const round = roundStats.get(id);
      const total = totalStats.get(id);
      round.correct += 1;
      round.timeMs += elapsed;
      total.correct += 1;
      total.timeMs += elapsed;
      total.score += CONFIG.marks[currentRound];
    }
    callback({ success: true, accepted: true });
  });

  socket.on("disconnect", () => {
    // Keep the participant record and score so a dropped connection can rejoin.
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`CLOUD CLASH server listening on ${PORT}`));
