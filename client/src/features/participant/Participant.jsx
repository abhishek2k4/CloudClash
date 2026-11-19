import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../../services/socket";
import { getSession } from "../../services/auth";


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
  initialCode = "",
  autoJoin = false,
  onJoinFailure
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);

  useEffect(() => {
    if (!participantRef.current && initialName) setName(initialName);
  }, [initialName]);
  const participantRef = useRef(null);
  const autoJoinAttemptedRef = useRef(false);

  const [participant, setParticipant] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [question, setQuestion] = useState(null);
  const [round, setRound] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(20);
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [personalReport, setPersonalReport] = useState(null);
  const [personalRoundReport, setPersonalRoundReport] = useState(null);
  const [resultsRevealed, setResultsRevealed] = useState(false);
  const [expandedRoundReport, setExpandedRoundReport] = useState(false);
  const [status, setStatus] = useState("waiting");
  const [eliminated, setEliminated] = useState(false);
  const [error, setError] = useState("");

  const apply = useCallback((r, joinedCode) => {
    if (!r?.success) {
      const message = r?.message || "Could not join this room. Check the room code and try again.";
      setError(message);
      if (autoJoin) onJoinFailure?.(message);
      return;
    }
    const p = { ...r.participant, name: r.participant.name, code: joinedCode, eliminated: Boolean(r.snapshot?.eliminated) };
    participantRef.current = p;
    setParticipant(p);
    setParticipants(r.snapshot?.participants || []);
    setStatus(r.snapshot?.status || "waiting");
    setRound(r.snapshot?.round || 0);
    setLeaderboard(r.snapshot?.leaderboard || []);
    setPersonalReport(r.snapshot?.personalReport || null);
    setPersonalRoundReport(r.snapshot?.personalRoundReport || null);
    setResultsRevealed(Boolean(r.snapshot?.resultsRevealed));
    setEliminated(Boolean(r.snapshot?.eliminated));
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
  }, [autoJoin, onJoinFailure]);

  useEffect(() => {
    socket.auth = (callback) => {
      getSession().then((current) => callback(current?.accessToken ? { accessToken: current.accessToken } : {})).catch(() => callback({}));
    };
    const people = setParticipants;
    const onStatus = (nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus === "paused") {
        setLeaderboard([]);
        setResult(null);
      }
    };
    const onQuestion = (q) => {
      if (participantRef.current?.eliminated) return;
      setRound(q.round || 0);
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
      setRound(d.round || 0);
      setStatus("running");
      setResult({ message: "Round " + d.round + " is starting" });
    };
    const onBreak = (d) => {
      setRound(d.round || 0);
      setStatus("round_break");
      setQuestion(null);
      setLeaderboard([]);
      setPersonalRoundReport(null);
      setResult({ message: "Round complete" });
    };
    const onEliminationsConfirmed = (d) => {
      if (participantRef.current && (d.eliminatedIds || []).includes(participantRef.current.id)) {
        setEliminated(true);
        participantRef.current = { ...participantRef.current, eliminated: true };
        setQuestion(null);
        setSelected(null);
      }
    };
    const onFinish = (d) => {
      setStatus("finished");
      setLeaderboard([]);
      setResultsRevealed(false);
      setQuestion(null);
    };
    const onPersonalFinalReport = (d) => setPersonalReport(d.report || null);
    const onPersonalRoundReport = (d) => setPersonalRoundReport(d || null);
    const onFinalLeaderboardRevealed = (d) => {
      setLeaderboard(d.leaderboard || []);
      setResultsRevealed(true);
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
    socket.on("eliminations_confirmed", onEliminationsConfirmed);
    socket.on("competition_finished", onFinish);
    socket.on("personal_final_report", onPersonalFinalReport);
    socket.on("personal_round_report", onPersonalRoundReport);
    socket.on("final_leaderboard_revealed", onFinalLeaderboardRevealed);
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

    const onConnectError = (err) => {
      const message = err?.message || "Could not connect to the quiz server.";
      setError(message);
      if (autoJoin) onJoinFailure?.(message);
    };
    socket.on("connect", connect);
    socket.on("connect_error", onConnectError);
    socket.connect();

    return () => {
      socket.off("participants_updated", people);
      socket.off("competition_status_updated", onStatus);
      socket.off("question_started", onQuestion);
      socket.off("question_resumed", onResume);
      socket.off("question_ended", onEnd);
      socket.off("round_started", onRound);
      socket.off("round_finished", onBreak);
      socket.off("eliminations_confirmed", onEliminationsConfirmed);
      socket.off("competition_finished", onFinish);
      socket.off("personal_final_report", onPersonalFinalReport);
      socket.off("personal_round_report", onPersonalRoundReport);
      socket.off("final_leaderboard_revealed", onFinalLeaderboardRevealed);
      socket.off("competition_cancelled", onCancelled);
      socket.off("connect", connect);
      socket.off("connect_error", onConnectError);
      socket.disconnect();
      socket.auth = {};
    };
  }, [apply, autoJoin, onJoinFailure]);

  useEffect(() => {
    if (!question || status !== "running") return;
    const tick = () =>
      setSeconds(Math.max(0, Math.ceil((question.endsAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [question, status]);

  const join = useCallback((e) => {
    e?.preventDefault();
    if (!name.trim() || !code.trim()) {
      const message = "Enter your room code and display name first.";
      setError(message);
      if (autoJoin) onJoinFailure?.(message);
      return;
    }
    setError("");
    const cleanCode = code.trim().toUpperCase();
    socket.emit("join_competition", { name: name.trim(), code: cleanCode }, (r) =>
      apply(r, cleanCode)
    );
  }, [name, code, apply, autoJoin, onJoinFailure]);

  useEffect(() => {
    if (!autoJoin || autoJoinAttemptedRef.current) return;
    autoJoinAttemptedRef.current = true;
    join();
  }, [autoJoin, join]);

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
    if (eliminated || submitted || !question || !participant || result || selected === optionIndex) return;
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

  /* Automatic home-page join: never show the legacy entry form. */
  if (!participant && autoJoin) {
    return (
      <main className="participant-joining-screen" role="status" aria-live="polite">
        <header className="lobby-topbar joining-topbar">
          <div className="lobby-brand">
            <span className="lobby-brand-mark"><img src="/assets/cloudclash/branding/logo-mark.svg" alt="" /></span>
            <strong>CLOUDCLASH</strong>
            <i />
            <span>PLAYER</span>
          </div>
          <div className="lobby-topbar-actions">
            <span className="lobby-waiting-pill"><i /> CONNECTING</span>
          </div>
        </header>
        <section className="joining-content">
          <p className="joining-kicker">PLAYER ENTRY · {code || initialCode}</p>
          <h1 className="joining-title">You're almost <span>in.</span></h1>
          <div className="joining-card">
            <div className="joining-loader" aria-hidden="true"><span /></div>
            <div className="joining-copy">
              <p className="lobby-section-label">ESTABLISHING CONNECTION</p>
              <h2>Joining the arena…</h2>
              <p>Getting your seat ready. You'll be taken straight to the lobby.</p>
            </div>
            <div className="joining-progress" aria-hidden="true"><span /></div>
            {error && <div className="error-banner">{error}</div>}
          </div>
          <p className="joining-footnote">Keep this tab open while we connect you.</p>
        </section>
      </main>
    );
  }

  if (status === "paused") {
    return (
      <main className="participant-paused-screen">
        <header className="lobby-topbar paused-topbar">
          <div className="lobby-brand">
            <span className="lobby-brand-mark"><img src="/assets/cloudclash/branding/logo-mark.svg" alt="" /></span>
            <strong>CLOUD<span>CLASH</span></strong>
            <i />
            <span>PLAYER</span>
            <i />
            <span>{participant?.name || name}</span>
            <i />
            <span>ROOM {participant?.code || code}</span>
          </div>
          <div className="lobby-topbar-actions">
            <span className="lobby-waiting-pill paused-status-pill"><i /> PAUSED</span>
            <button type="button" className="lobby-leave-button" onClick={requestHome}>Leave</button>
          </div>
        </header>
        <section className="paused-content">
          <div className="paused-card">
            <div className="paused-icon" aria-hidden="true"><span /><span /></div>
            <p className="lobby-section-label">MATCH PAUSED</p>
            <h1 className="paused-title">Quiz <span>on Hold.</span></h1>
            <p className="paused-description">
              The host has paused the quiz. Please wait here until the host resumes.
            </p>
            <button type="button" className="paused-leave-button" onClick={requestHome}>Leave Quiz</button>
          </div>
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
    <main className={`app-shell ${status === "waiting" ? "ready-lobby-screen" : status === "running" ? "participant-live-screen" : status === "finished" ? "participant-finished-screen" : ""}`}>
      {status === "waiting" ? (
        <header className="lobby-topbar">
          <div className="lobby-brand">
            <span className="lobby-brand-mark"><img src="/assets/cloudclash/branding/logo-mark.svg" alt="" /></span>
            <strong>CLOUD<span>CLASH</span></strong>
            <span>ROOM {participant.code}</span>
          </div>
          <div className="lobby-topbar-actions">
            <span className="lobby-waiting-pill"><i /> WAITING</span>
            <button type="button" className="lobby-leave-button" onClick={requestHome}>Leave</button>
          </div>
        </header>
      ) : status === "running" ? (
        <header className="lobby-topbar live-topbar">
          <div className="lobby-brand">
            <span className="lobby-brand-mark"><img src="/assets/cloudclash/branding/logo-mark.svg" alt="" /></span>
            <strong>CLOUD<span>CLASH</span></strong>
            <span>ROOM {participant.code}</span>
          </div>
          <div className="lobby-topbar-actions">
            <span className="lobby-waiting-pill live-running-pill"><i /> RUNNING</span>
            <button type="button" className="lobby-leave-button" onClick={requestHome}>Leave</button>
          </div>
        </header>
      ) : status === "finished" ? (
        <header className="lobby-topbar finished-topbar">
          <div className="lobby-brand">
            <span className="lobby-brand-mark"><img src="/assets/cloudclash/branding/logo-mark.svg" alt="" /></span>
            <strong>CLOUD<span>CLASH</span></strong>
            <span>ROOM {participant.code}</span>
          </div>
          <div className="lobby-topbar-actions">
            <span className="lobby-waiting-pill finished-status-pill"><i /> FINISHED</span>
            <button type="button" className="lobby-leave-button" onClick={requestHome}>Leave</button>
          </div>
        </header>
      ) : (
        <header className="dashboard-head">
          <div>
            <p className="eyebrow">PLAYER · {participant.name} · ROOM {participant.code}</p>
            <h1>Match Concluded</h1>
          </div>
          <div className="header-actions">
            <span className={`status-chip ${status}`}>{status.replace("_", " ")}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={requestHome}>Leave</button>
          </div>
        </header>
      )}

      {question && status === "running" && (
        <section className="participant-live-content">
          <h1 className="participant-live-title">Stay <span>Sharp.</span></h1>
          <div className="arena-card participant-question-card">
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
            <div className="selection-notice">Option {String.fromCharCode(65 + selected)} selected. You can change it until the timer ends.</div>
          )}
          {result?.correctOption !== undefined && result.explanation && (
            <div className="surface-card" style={{ marginTop: 14 }}>
              <p className="eyebrow">EXPLANATION</p>
              <p className="muted">{result.explanation}</p>
            </div>
          )}
          </div>
        </section>
      )}

      {!question && status === "waiting" && (
        <section className="lobby-content">
          <div className="lobby-title-block">
            <p className="lobby-room-label">ROOM {participant.code}</p>
            <h1>Ready in <span>Lobby</span></h1>
          </div>
          <section className="lobby-roster-card">
            <div className="lobby-roster-heading">
              <div>
                <p className="lobby-section-label">WAITING FOR HOST</p>
                <h2>You're on the roster.</h2>
              </div>
              <span className="lobby-connected-count">{participants.length} CONNECTED</span>
            </div>
            <p className="lobby-description">The match will begin automatically as soon as the host launches Round 01.</p>
            <div className="lobby-roster-divider" />
            {participants.length > 0 && (
              <div className="lobby-player-list">
                {participants.map((p) => (
                  <div className="lobby-player-row" key={p.id}>
                    <span className="lobby-player-avatar">{getInitials(p.name).slice(0, 1)}</span>
                    <strong>{p.name}{p.id === participant.id ? " (You)" : ""}</strong>
                    <span className="lobby-player-presence" aria-label="Connected" />
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      )}

      {!question && status === "running" && (
        <section className="surface-card">
          <p className="eyebrow">{eliminated ? "SPECTATOR MODE" : "TELEMETRY SYNC"}</p>
          <h2>{eliminated ? "You're watching the remaining rounds" : "Question Closed"}</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            {eliminated ? "Your competition has ended. You can still follow the live match and standings." : "Stand by for the next prompt."}
          </p>
          {result?.correctOption !== undefined && (
            <div className="success-banner">
              Verified Answer: Option {String.fromCharCode(65 + result.correctOption)}
            </div>
          )}
        </section>
      )}

      {status === "round_break" && (
        <section className="surface-card personal-report finished-personal-report">
          <p className="eyebrow">ROUND {String(personalRoundReport?.round || round).padStart(2, "0")} COMPLETE</p>
          <h2>{eliminated ? "Your run is complete" : "Your round report"}</h2>
          {personalRoundReport?.report ? (
            <>
              <div className="personal-report-score"><strong>{Number(personalRoundReport.roundScore || 0).toFixed(2)}</strong><span>ROUND POINTS</span></div>
              <div className="personal-report-grid">
                <div><small>ATTEMPTED</small><strong>{personalRoundReport.report.attempted || 0}</strong></div>
                <div><small>CORRECT</small><strong className="host-player-correct">{personalRoundReport.report.correct || 0}</strong></div>
                <div><small>WRONG</small><strong className="host-player-wrong">{personalRoundReport.report.wrong || 0}</strong></div>
                <div><small>ACCURACY</small><strong>{personalRoundReport.report.accuracy == null ? "N/A" : `${personalRoundReport.report.accuracy.toFixed(1)}%`}</strong></div>
                <div><small>AVG RESPONSE</small><strong>{personalRoundReport.report.avgResponseMs == null ? "—" : `${(personalRoundReport.report.avgResponseMs / 1000).toFixed(2)}s`}</strong></div>
                <div><small>FASTEST CORRECT</small><strong>{personalRoundReport.report.fastestCorrectMs == null ? "—" : `${(personalRoundReport.report.fastestCorrectMs / 1000).toFixed(2)}s`}</strong></div>
                <div><small>SPEED BONUS</small><strong className="personal-bonus">+{Number(personalRoundReport.report.speedBonus || 0).toFixed(2)}</strong></div>
                <div><small>BEST STREAK</small><strong>{personalRoundReport.report.bestStreak || 0} in a row</strong></div>
              </div>
            </>
          ) : <p className="muted">No answers were recorded for this round.</p>}
          <p className="muted" style={{marginTop:14}}>{eliminated ? "Your competition has ended. Your completed-round stats are saved." : "Stand by. The host will start the next round shortly."}</p>
        </section>
      )}

      {status === "finished" && (
        <section className="finished-content">
          <h1 className="finished-title">Match <span>Concluded.</span></h1>
        </section>
      )}
      {status === "finished" && !resultsRevealed && (
        <section className="surface-card results-waiting-card">
          <div className="results-spinner" />
          <p className="eyebrow">FINAL RESULTS SEALED</p>
          <h2>Waiting for the reveal…</h2>
          <p className="muted">The host is getting ready to reveal the final standings. Hold tight.</p>
        </section>
      )}
      {status === "finished" && resultsRevealed && (() => {
        const mine = personalReport || leaderboard.find((entry) => entry.id === participant?.id);
        const stats = mine?.stats || {};
        return (
          <section className="surface-card personal-report">
            <div className="personal-report-heading"><div><p className="eyebrow">YOUR FINAL PERFORMANCE</p><h2>Personal Report</h2></div><div className="personal-rank">#{String(mine?.rank || "—").padStart(2, "0")}<small>FINAL RANK</small></div></div>
            <div className="personal-report-score"><strong>{Number(mine?.score || 0).toFixed(2)}</strong><span>POINTS</span></div>
            <div className="personal-report-grid">
              <div><small>ATTEMPTED</small><strong>{stats.attempted || 0}</strong></div><div><small>CORRECT</small><strong className="host-player-correct">{stats.correct || 0}</strong></div>
              <div><small>WRONG</small><strong className="host-player-wrong">{stats.wrong || 0}</strong></div><div><small>ACCURACY</small><strong>{stats.accuracy == null ? "N/A" : `${stats.accuracy.toFixed(1)}%`}</strong></div>
              <div><small>AVG RESPONSE</small><strong>{stats.avgResponseMs == null ? "—" : `${(stats.avgResponseMs / 1000).toFixed(2)}s`}</strong></div>
              <div><small>FASTEST CORRECT</small><strong>{stats.fastestCorrectMs == null ? "—" : `${(stats.fastestCorrectMs / 1000).toFixed(2)}s`}</strong></div>
              <div><small>SPEED BONUS</small><strong className="personal-bonus">+{Number(stats.speedBonus || 0).toFixed(2)}</strong></div><div><small>BEST STREAK</small><strong>{stats.bestStreak || 0} in a row</strong></div>
            </div>
            <button type="button" className="personal-round-toggle" onClick={() => setExpandedRoundReport((value) => !value)} aria-expanded={expandedRoundReport}>Round-wise performance <span>{expandedRoundReport ? "−" : "+"}</span></button>
            {expandedRoundReport && <div className="personal-round-list">{Object.entries(mine?.roundStats || {}).map(([roundNo, data]) => (
              <div className="personal-round-card" key={roundNo}>
                <div className="personal-round-title"><strong>Round {roundNo}</strong><b>{(Number(data.basePoints || 0) + Number(data.speedBonus || 0)).toFixed(2)} pts</b></div>
                <div className="personal-round-metrics"><span>{data.attempted || 0} attempted</span><span>{data.correct || 0} correct</span><span>{data.wrong || 0} wrong</span><span>{data.accuracy == null ? "N/A" : `${data.accuracy.toFixed(0)}% accuracy`}</span><span>Avg {data.avgResponseMs == null ? "—" : `${(data.avgResponseMs / 1000).toFixed(2)}s`}</span><span>Fastest {data.fastestCorrectMs == null ? "—" : `${(data.fastestCorrectMs / 1000).toFixed(2)}s`}</span><span>Bonus +{Number(data.speedBonus || 0).toFixed(2)}</span></div>
              </div>
            ))}</div>}
          </section>
        );
      })()}
      {/* {status === "finished" && (
        <section className="surface-card finished-telemetry-card">
          <p className="eyebrow">FINAL TELEMETRY</p>
          <h2>Match Complete</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Final scores have been recorded. Check your placement below.
          </p>
        </section>
      )} */}

      {status === "finished" && resultsRevealed && leaderboard.length >= 3 && <div className="confetti-overlay" aria-hidden="true">{Array.from({ length: 42 }, (_, i) => <i key={i} style={{ "--confetti-x": `${(i * 37) % 100}%`, "--confetti-delay": `${(i % 9) * -0.37}s`, "--confetti-duration": `${4 + (i % 5)}s`, "--confetti-rotation": `${i * 47}deg` }} />)}</div>}
      {(status === "round_break" || (status === "finished" && resultsRevealed)) && (
        <section className={`surface-card ${status === "finished" ? "finished-scoreboard-card" : ""}`}>
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
                    <span className="podium-name">{actualRank === 1 ? "👑 " : ""}{p.name}</span>
                    <span className="podium-score">{Number(p.score).toFixed(2)} pts</span>
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
                    {p.rank === 1 ? "👑 " : ""}{p.name} {p.id === participant.id ? "(You)" : ""} {p.eliminated ? "(Eliminated)" : ""}
                  </strong>
                </div>
                <span className="standing-score">{Number(p.score).toFixed(2)} pts</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <div className="error-banner">{error}</div>}
    </main>
  );
}