import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import "./App.css";

const getInitials = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "PL";

export default function Participant({
  onHome,
  onActivityChange,
  initialName = "",
  initialCode = ""
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const participantRef = useRef(null);

  const [participant, setParticipant] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [question, setQuestion] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(20);
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [status, setStatus] = useState("waiting");
  const [error, setError] = useState("");

  const apply = useCallback((r, joinedCode) => {
    if (!r?.success) {
      setError(r?.message || "Could not join.");
      return;
    }
    const p = { ...r.participant, name: r.participant.name, code: joinedCode };
    participantRef.current = p;
    setParticipant(p);
    setParticipants(r.snapshot?.participants || []);
    setStatus(r.snapshot?.status || "waiting");
    setLeaderboard(r.snapshot?.leaderboard || []);
    const snapQ = r.snapshot?.question || null;
    setQuestion(snapQ);
    setSelected(r.snapshot?.answer?.selectedOption ?? null);
    setSubmitted(Boolean(r.snapshot?.lastQuestionResult) || (Boolean(r.snapshot?.answer) && r.snapshot?.status !== "running"));
    setResult(r.snapshot?.lastQuestionResult || null);
    if (snapQ?.endsAt) {
      const rem = Math.max(0, Math.ceil((snapQ.endsAt - Date.now()) / 1000));
      setSeconds(rem);
      setTotalSeconds(snapQ.duration || rem || 20);
    } else {
      setSeconds(0);
    }
  }, []);

  useEffect(() => {
    const people = setParticipants;
    const onStatus = setStatus;
    const onQuestion = (q) => {
      setQuestion(q);
      setSelected(null);
      setSubmitted(false);
      setResult(null);
      const rem = Math.max(0, Math.ceil((q.endsAt - Date.now()) / 1000));
      setSeconds(rem);
      setTotalSeconds(q.duration || rem || 20);
      setStatus("running");
    };
    const onResume = (d) => setQuestion((q) => (q ? { ...q, endsAt: d.endsAt } : q));
    const onEnd = (d) => {
      setResult(d);
      setSubmitted(true);
    };
    const onRound = (d) => {
      setStatus("running");
      setResult({ message: "Round " + d.round + " is starting" });
    };
    const onBreak = (d) => {
      setStatus("round_break");
      setQuestion(null);
      setLeaderboard(d.leaderboard || []);
      setResult({ message: "Round complete" });
    };
    const onFinish = (d) => {
      setStatus("finished");
      setLeaderboard(d.leaderboard || []);
      setQuestion(null);
    };
    const onCancelled = () => {
      participantRef.current = null;
      setParticipant(null);
      setQuestion(null);
      setStatus("cancelled");
      setError("The host cancelled this quiz. You have been removed from the room.");
    };

    socket.on("participants_updated", people);
    socket.on("competition_status_updated", onStatus);
    socket.on("question_started", onQuestion);
    socket.on("question_resumed", onResume);
    socket.on("question_ended", onEnd);
    socket.on("round_started", onRound);
    socket.on("round_finished", onBreak);
    socket.on("competition_finished", onFinish);
    socket.on("competition_cancelled", onCancelled);

    const connect = () => {
      const p = participantRef.current;
      if (p) {
        socket.emit(
          "join_competition",
          { name: p.name, code: p.code, participantId: p.id },
          (r) => apply(r, p.code)
        );
      }
    };

    socket.on("connect", connect);
    socket.connect();

    return () => {
      socket.off("participants_updated", people);
      socket.off("competition_status_updated", onStatus);
      socket.off("question_started", onQuestion);
      socket.off("question_resumed", onResume);
      socket.off("question_ended", onEnd);
      socket.off("round_started", onRound);
      socket.off("round_finished", onBreak);
      socket.off("competition_finished", onFinish);
      socket.off("competition_cancelled", onCancelled);
      socket.off("connect", connect);
      socket.disconnect();
    };
  }, [apply]);

  useEffect(() => {
    if (!question || status !== "running") return;
    const tick = () =>
      setSeconds(Math.max(0, Math.ceil((question.endsAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [question, status]);

  const join = (e) => {
    e?.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setError("");
    const cleanCode = code.trim().toUpperCase();
    socket.emit("join_competition", { name: name.trim(), code: cleanCode }, (r) =>
      apply(r, cleanCode)
    );
  };

  useEffect(() => {
    onActivityChange?.(Boolean(participant) && !["finished", "cancelled"].includes(status));
    return () => onActivityChange?.(false);
  }, [participant, status, onActivityChange]);

  const requestHome = () => {
    if (participant && status !== "finished") {
      const leave = window.confirm(
        "You're in a live quiz. If you leave, you'll stop participating and may lose your place in the game. Do you really want to leave?"
      );
      if (!leave) return;
    }
    onHome();
  };

  const selectOption = (optionIndex) => {
    if (submitted || !question || !participant || result || selected === optionIndex) return;
    setSelected(optionIndex);
    setError("");
    socket.emit(
      "submit_answer",
      {
        participantId: participant.id,
        questionNumber: question.questionNumber,
        selectedOption: optionIndex
      },
      (r) => {
        if (!r?.success) {
          setError(r?.message || "Your selection could not be saved.");
        }
      }
    );
  };

  if (status === "cancelled") {
    return (
      <main className="app-shell narrow">
        <section className="surface-card">
          <p className="eyebrow">ROOM CANCELLED</p>
          <h1>Quiz cancelled.</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            The host has cancelled this room. You are no longer connected to the quiz.
          </p>
          <button type="button" className="btn btn-primary btn-full" style={{ marginTop: 20 }} onClick={onHome}>
            Back to Home
          </button>
        </section>
      </main>
    );
  }

  /* ENTRY VIEW */
  if (!participant) {
    return (
      <main className="app-shell narrow">
        <button className="back-link" onClick={requestHome}>
          ← Back to Home
        </button>

        <section className="surface-card">
          <p className="eyebrow">PLAYER ENTRY</p>
          <h1>Enter the Arena.</h1>
          <p className="muted" style={{ marginTop: 6, marginBottom: 20 }}>
            Confirm your display name and the room access code shared by your host.
          </p>

          <form onSubmit={join} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field-group">
              <label className="field-label" htmlFor="join-code">Room Code</label>
              <input
                id="join-code"
                className="input-control input-code"
                placeholder="CODE"
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>

            <div className="field-group">
              <label className="field-label" htmlFor="join-name">Display Name</label>
              <input
                id="join-name"
                className="input-control"
                placeholder="Your name on the leaderboard"
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-full"
              style={{ marginTop: 6 }}
              disabled={!name.trim() || !code.trim()}
            >
              Join Room →
            </button>
          </form>

          {error && <div className="error-banner">{error}</div>}
        </section>
      </main>
    );
  }

  const progressPct = question
    ? Math.min(100, Math.max(0, (seconds / Math.max(1, totalSeconds)) * 100))
    : 0;
  const timerState = seconds <= 5 ? "urgent" : seconds <= 10 ? "warning" : "";

  /* ACTIVE MATCH & LOBBY VIEW */
  return (
    <main className="app-shell">
      <header className="dashboard-head">
        <div>
          <p className="eyebrow">
            PLAYER · {participant.name} · ROOM {participant.code}
          </p>
          <h1>
            {status === "waiting"
              ? "Ready in Lobby"
              : status === "finished"
              ? "Match Concluded"
              : "Stay Sharp."}
          </h1>
        </div>

        <div className="header-actions">
          <span className={`status-chip ${status}`}>{status.replace("_", " ")}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={requestHome}>
            Leave
          </button>
        </div>
      </header>

      {question && status === "running" && (
        <section className="arena-card">
          <div className="timer-track">
            <div className={`timer-fill ${timerState}`} style={{ width: `${progressPct}%` }} />
          </div>

          <div className="question-hud">
            <span className="hud-badge">
              ROUND {String(question.round).padStart(2, "0")} · Q{question.questionNumber}/
              {question.totalQuestions} · {question.marks} PTS
            </span>
            <span className={`timer-readout ${timerState}`}>{seconds}s</span>
          </div>

          <h2 className="question-prompt">{question.text}</h2>

          <div className="options-grid">
            {question.options.map((o, i) => {
              const isSelected = selected === i;
              const isRevealed = result?.correctOption !== undefined;
              const isCorrect = isRevealed && result.correctOption === i;
              const isIncorrectSelection = isRevealed && isSelected && !isCorrect;
              const tileClass = [
                "option-tile",
                !isRevealed && isSelected ? "selected" : "",
                isRevealed && isSelected ? "locked" : "",
                isCorrect ? "correct-answer" : "",
                isIncorrectSelection ? "incorrect-answer" : ""
              ].filter(Boolean).join(" ");
              return (
                <button
                  type="button"
                  key={i}
                  className={tileClass}
                  disabled={submitted || seconds === 0 || isRevealed}
                  onClick={() => selectOption(i)}
                >
                  <span className="option-key">{String.fromCharCode(65 + i)}</span>
                  <span className="option-text">{o}</span>
                  {isRevealed && isCorrect && <span className="option-feedback" aria-label="Correct answer">✓</span>}
                  {isRevealed && isIncorrectSelection && <span className="option-feedback" aria-label="Your answer was incorrect">✕</span>}
                </button>
              );
            })}
          </div>

          {selected !== null && !submitted && !result && (
            <div className="success-banner">Option {String.fromCharCode(65 + selected)} selected. You can change it until the timer ends.</div>
          )}
          {result?.correctOption !== undefined && result.explanation && (
            <div className="surface-card" style={{ marginTop: 14 }}>
              <p className="eyebrow">EXPLANATION</p>
              <p className="muted">{result.explanation}</p>
            </div>
          )}
        </section>
      )}

      {!question && status === "waiting" && (
        <section className="surface-card">
          <div className="section-header">
            <div>
              <p className="eyebrow" style={{ marginBottom: 2 }}>WAITING FOR HOST</p>
              <h2>You're on the roster.</h2>
            </div>
            <span className="status-chip">{participants.length} Connected</span>
          </div>
          <p className="muted">
            The match will begin automatically as soon as the host launches Round 01.
          </p>

          {participants.length > 0 && (
            <div className="roster-grid">
              {participants.map((p) => (
                <div className="player-chip" key={p.id}>
                  <span className="avatar-monogram">{getInitials(p.name)}</span>
                  <span className="player-chip-name">
                    {p.name} {p.id === participant.id ? "(You)" : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {status === "paused" && (
        <section className="surface-card" style={{ borderColor: "rgba(245, 158, 11, 0.35)" }}>
          <p className="eyebrow" style={{ color: "#fcd34d" }}>MATCH PAUSED</p>
          <h2>Session on hold.</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            The host has paused the match. Your current question and timer are frozen.
          </p>
        </section>
      )}

      {!question && status === "running" && (
        <section className="surface-card">
          <p className="eyebrow">TELEMETRY SYNC</p>
          <h2>Question Closed</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Stand by for the next prompt.
          </p>
          {result?.correctOption !== undefined && (
            <div className="success-banner">
              Verified Answer: Option {String.fromCharCode(65 + result.correctOption)}
            </div>
          )}
        </section>
      )}

      {status === "round_break" && (
        <section className="surface-card">
          <p className="eyebrow">INTERMISSION</p>
          <h2>Round Complete</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Standings updated. The host will initiate the next round shortly.
          </p>
        </section>
      )}

      {status === "finished" && (
        <section className="surface-card">
          <p className="eyebrow">FINAL TELEMETRY</p>
          <h2>Match Complete</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Final scores have been recorded. Check your placement below.
          </p>
        </section>
      )}

      {(status === "round_break" || status === "finished") && (
        <section className="surface-card">
          <p className="eyebrow">SCOREBOARD</p>
          <h2>{status === "finished" ? "Final Standings" : "Current Standings"}</h2>

          {leaderboard.length >= 3 && (
            <div className="podium-grid">
              {[leaderboard[1], leaderboard[0], leaderboard[2]].map((p, idx) => {
                const actualRank = idx === 0 ? 2 : idx === 1 ? 1 : 3;
                return (
                  <div className={`podium-slot rank-${actualRank}`} key={p.id}>
                    <span className="podium-rank">#{String(actualRank).padStart(2, "0")}</span>
                    <span className="avatar-monogram">{getInitials(p.name)}</span>
                    <span className="podium-name">{p.name}</span>
                    <span className="podium-score">{p.score} pts</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="standings-list">
            {leaderboard.map((p) => (
              <div className="standing-row" key={p.id}>
                <div className="standing-left">
                  <span className="standing-rank">#{String(p.rank).padStart(2, "0")}</span>
                  <span className="avatar-monogram">{getInitials(p.name)}</span>
                  <strong>
                    {p.name} {p.id === participant.id ? "(You)" : ""}
                  </strong>
                </div>
                <span className="standing-score">{p.score} pts</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <div className="error-banner">{error}</div>}
    </main>
  );
}