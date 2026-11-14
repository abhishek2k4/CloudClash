import { useCallback, useEffect, useState } from "react";
import { socket } from "./socket";
import "./App.css";

const blankQuestion = (round = 1) => ({
  id: crypto.randomUUID(),
  round,
  text: "",
  options: ["", "", "", ""],
  correctOption: 0,
  explanation: ""
});

const getInitials = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "PL";

export default function Host({ onHome, onActivityChange }) {
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [stage, setStage] = useState("room");
  const [roomName, setRoomName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [status, setStatus] = useState("idle");
  const [rounds, setRounds] = useState(2);
  const [activeConfigRound, setActiveConfigRound] = useState(1);
  const [settings, setSettings] = useState({
    roundSeconds: { 1: 15, 2: 25 },
    marks: { 1: 10, 2: 20 },
    speedBonusPercent: 10,
    advanceCounts: { 1: 0, 2: 0 }
  });
  const [participants, setParticipants] = useState([]);
  const [counts, setCounts] = useState({});
  const [round, setRound] = useState(0);
  const [question, setQuestion] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [roundElimination, setRoundElimination] = useState(null);
  const [eliminationsConfirmed, setEliminationsConfirmed] = useState(true);
  const [eliminatedIds, setEliminatedIds] = useState([]);
  const [questions, setQuestions] = useState([blankQuestion()]);
  const [error, setError] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [roundUploads, setRoundUploads] = useState({});
  const [copied, setCopied] = useState(false);

  const apply = useCallback((response) => {
    if (!response?.success) {
      setError(response?.message || "Could not open host controls.");
      return;
    }
    setAuthenticated(true);
    setRoomCode(response.roomCode || "");
    setRoomName(response.roomName || "");
    setStatus(response.status || "idle");
    setRounds(response.rounds || 2);
    if (response.quizSettings) setSettings(response.quizSettings);
    setParticipants(response.participants || []);
    setCounts(response.questionCounts || {});
    setRound(response.round || 0);
    setQuestion(response.question || null);
    setLeaderboard(response.leaderboard || []);
    setEliminatedIds(response.eliminatedIds || []);
    setEliminationsConfirmed(response.eliminationsConfirmed ?? true);
    if (response.status === "round_break") {
      const pending = response.pendingEliminationIds || [];
      const board = response.leaderboard || [];
      setRoundElimination({ keepCount: response.quizSettings?.advanceCounts?.[response.round] || null, advancingCount: board.filter((p) => !p.eliminated).length - pending.length, eliminatedCandidates: board.filter((p) => pending.includes(p.id)) });
    }
    // Restore the control dashboard for any existing room, including a live quiz.
    // Only a fresh/idle host session should remain on the room setup screen.
    setStage(response.roomCode ? "control" : "room");
  }, []);

  useEffect(() => {
    const connect = () => {
      setConnected(true);
      socket.emit("host_login", apply);
    };
    const disconnect = () => setConnected(false);
    const onPeople = setParticipants;
    const onStatus = setStatus;
    const onQuestion = (q) => {
      setQuestion(q);
      setRound(q.round);
      setSeconds(Math.max(0, Math.ceil((q.endsAt - Date.now()) / 1000)));
    };
    const onResume = (d) => setQuestion((q) => (q ? { ...q, endsAt: d.endsAt } : q));
    const onEnded = () => setQuestion(null);
    const onRound = (d) => {
      setRound(d.round);
      setRoundElimination(null);
      setEliminationsConfirmed(true);
      setStatus("running");
      setQuestion(null);
    };
    const onBreak = (d) => {
      setLeaderboard(d.leaderboard || []);
      setRoundElimination(d);
      setEliminationsConfirmed(d.eliminationsConfirmed ?? true);
      setStatus("round_break");
      setQuestion(null);
    };
    const onEliminationsConfirmed = (d) => {
      setLeaderboard(d.leaderboard || []);
      setEliminatedIds(d.eliminatedIds || []);
      setEliminationsConfirmed(true);
      setRoundElimination((current) => current ? { ...current, eliminatedCandidates: [], advancingCount: d.advancingCount } : current);
    };
    const onFinish = (d) => {
      setLeaderboard(d.leaderboard || []);
      setStatus("finished");
      setQuestion(null);
    };

    socket.on("connect", connect);
    socket.on("disconnect", disconnect);
    socket.on("participants_updated", onPeople);
    socket.on("competition_status_updated", onStatus);
    socket.on("question_started", onQuestion);
    socket.on("question_resumed", onResume);
    socket.on("question_ended", onEnded);
    socket.on("round_started", onRound);
    socket.on("round_finished", onBreak);
    socket.on("eliminations_confirmed", onEliminationsConfirmed);
    socket.on("competition_finished", onFinish);
    socket.connect();

    return () => {
      socket.off("connect", connect);
      socket.off("disconnect", disconnect);
      socket.off("participants_updated", onPeople);
      socket.off("competition_status_updated", onStatus);
      socket.off("question_started", onQuestion);
      socket.off("question_resumed", onResume);
      socket.off("question_ended", onEnded);
      socket.off("round_started", onRound);
      socket.off("round_finished", onBreak);
      socket.off("eliminations_confirmed", onEliminationsConfirmed);
      socket.off("competition_finished", onFinish);
      socket.disconnect();
    };
  }, [apply]);

  useEffect(() => {
    setError("");
  }, [stage]);

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    onActivityChange?.(["running", "paused", "round_break"].includes(status));
    return () => onActivityChange?.(false);
  }, [status, onActivityChange]);

  const requestHome = () => {
    if (["running", "paused", "round_break"].includes(status)) {
      const leave = window.confirm(
        "The quiz is currently in progress. If you leave this page, you may lose access to host controls. The quiz will continue for players. Do you really want to leave?"
      );
      if (!leave) return;
    }
    onHome();
  };

  useEffect(() => {
    if (!question || status !== "running") return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((question.endsAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [question, status]);

  const action = (event, payload, done, failed) => {
    setError("");
    const callback = (r) => {
      if (!r?.success) {
        setError(r?.message || "Action failed.");
        failed?.(r);
      } else done?.(r);
    };
    if (payload === undefined) socket.emit(event, callback);
    else socket.emit(event, payload, callback);
  };

  const addRound = () => {
    if (rounds >= 10) return;
    const next = rounds + 1;
    setRounds(next);
    setSettings((s) => ({ ...s, roundSeconds: { ...s.roundSeconds, [next]: 20 }, marks: { ...s.marks, [next]: 10 }, advanceCounts: { ...s.advanceCounts, [next]: 0 } }));
    setActiveConfigRound(next);
  };

  const removeRound = (target) => {
    if (rounds <= 1) return;
    const nextTotal = rounds - 1;
    setSettings((s) => {
      const rs = {};
      const mk = {};
      const ac = {};
      let idx = 1;
      for (let i = 1; i <= rounds; i++) {
        if (i === target) continue;
        rs[idx] = s.roundSeconds[i] ?? 20;
        mk[idx] = s.marks[i] ?? 10;
        ac[idx] = s.advanceCounts?.[i] ?? 0;
        idx++;
      }
      return { ...s, roundSeconds: rs, marks: mk, advanceCounts: ac };
    });
    setRounds(nextTotal);
    setActiveConfigRound((prev) => Math.min(prev, nextTotal));
  };

  const setValue = (group, n, v) => {
    const limits = group === "roundSeconds" ? { min: 5, max: 300 } : { min: 1, max: 100 };
    const value = Math.min(limits.max, Math.max(limits.min, Number(v) || limits.min));
    setSettings((s) => ({
      ...s,
      [group]: { ...s[group], [n]: value }
    }));
  };

  const create = () => {
    const payload = { roomName, rounds, roundSeconds: settings.roundSeconds, marks: settings.marks, speedBonusPercent: settings.speedBonusPercent ?? 10, advanceCounts: settings.advanceCounts ?? {} };
    if (roomCode) {
      action("update_quiz_config", payload, (r) => {
        setRounds(r.rounds);
        setSettings(r.quizSettings);
        setCounts(r.questionCounts);
        setStage("lobby");
        setImportStatus("Quiz configuration saved.");
      });
      return;
    }
    action("create_quiz", payload, (r) => {
      setRoomCode(r.roomCode);
      setCounts(r.questionCounts);
      setRoomName(r.roomName);
      setStatus("waiting");
      setStage("method");
    });
  };

  const updateQuestion = (index, patch) =>
    setQuestions((qs) => qs.map((q, i) => (i === index ? { ...q, ...patch } : q)));

  const saveManual = () => {
    if (!questions.length) return setError("Add at least one question.");
    action(
      "save_questions",
      {
        questions: questions.map(({ round: r, text, options, correctOption, explanation }) => ({
          round: r,
          text,
          options,
          correctOption,
          explanation
        }))
      },
      (r) => {
        setCounts(r.counts);
        setStatus("waiting");
        setStage("lobby");
        setImportStatus("Questions saved successfully.");
      }
    );
  };

  const downloadRoundTemplate = (n) => {
    const csv = "question,option_a,option_b,option_c,option_d,correct_option,explanation\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" }));
    a.download = "cloud-clash-round-" + n + "-questions.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const uploadRound = async (e, n) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setRoundUploads((s) => ({ ...s, [n]: "Uploading..." }));
    try {
      const csv = await file.text();
      action("import_round_questions", { round: n, csv }, (r) => {
        setCounts(r.counts);
        setRoundUploads((s) => ({ ...s, [n]: `${r.counts[n]} questions verified` }));
        setImportStatus(`Round ${n} question bank uploaded.`);
        if (Array.from({ length: rounds }, (_, i) => i + 1).every((k) => (r.counts[k] || 0) > 0)) {
          setStatus("waiting");
          setStage("lobby");
        }
      }, () => {
        setRoundUploads((s) => ({ ...s, [n]: "Upload failed — check the CSV headers and format" }));
      });
    } catch {
      setError("Could not read the CSV file.");
      setRoundUploads((s) => ({ ...s, [n]: "Upload failed" }));
    }
    e.target.value = "";
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!authenticated) {
    return (
      <main className="app-shell narrow">
        <button className="back-link" onClick={requestHome}>
          ← Home
        </button>
        <section className="surface-card">
          <p className="eyebrow">HOST SETUP</p>
          <h1>Initializing Control Room</h1>
          <p className="muted" style={{ marginTop: 10 }}>
            {connected ? "Authenticating host session..." : "Connecting to arena server..."}
          </p>
          {error && <div className="error-banner">{error}</div>}
        </section>
      </main>
    );
  }

  /* BASIC ROOM SETUP */
  if (stage === "room") {
    return (
      <main className="app-shell narrow">
        <button className="back-link" onClick={requestHome}>← Back to Home</button>
        <header style={{ marginBottom: 22 }}>
          <p className="eyebrow">STEP 01 · ROOM SETUP</p>
          <h1>Create your quiz.</h1>
          <p className="muted" style={{ marginTop: 6 }}>Start with the essentials. Fine-tune each round in advanced configuration.</p>
        </header>
        <section className="surface-card">
          <div className="field-group">
            <label className="field-label" htmlFor="room-name-input">Room Title</label>
            <input id="room-name-input" className="input-control" autoFocus maxLength={60}
              placeholder="e.g. CLOUD CLASH FINALS" value={roomName}
              onChange={(e) => setRoomName(e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="round-count-input">Number of Rounds</label>
            <select id="round-count-input" className="select-control" value={rounds}
              onChange={(e) => {
                const next = Number(e.target.value);
                setRounds(next);
                setActiveConfigRound((current) => Math.min(current, next));
                setSettings((current) => {
                  const roundSeconds = { ...current.roundSeconds };
                  const marks = { ...current.marks };
                  for (let n = 1; n <= next; n++) {
                    roundSeconds[n] ??= 20;
                    marks[n] ??= 10;
                  }
                  return { ...current, roundSeconds, marks };
                });
              }}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} rounds</option>)}
            </select>
          </div>
          <div className="telemetry-strip">
            <div className="telemetry-cell"><span>Total Rounds</span><strong>{String(rounds).padStart(2, "0")}</strong></div>
            <div className="telemetry-cell"><span>Default Timer</span><strong>{settings.roundSeconds[1] || 20}s / Q</strong></div>
            <div className="telemetry-cell"><span>Default Points</span><strong>{settings.marks[1] || 10} PTS</strong></div>
          </div>
          <button type="button" className="btn btn-secondary btn-full" style={{ marginTop: 18 }}
            onClick={() => setStage("advanced")}>
            <span>Advanced Quiz Configuration →</span>
          </button>
          {error && <div className="error-banner">{error}</div>}
        </section>
      </main>
    );
  }

  /* ADVANCED QUIZ CONFIGURATION */
  if (stage === "advanced") {
    const currentSeconds = settings.roundSeconds[activeConfigRound] ?? 20;
    const currentMarks = settings.marks[activeConfigRound] ?? 10;

    return (
      <main className="app-shell narrow">
        <button className="back-link" onClick={requestHome}>
          ← Back to Home
        </button>

        <header style={{ marginBottom: 22 }}>
          <p className="eyebrow">STEP 01 · MATCH ARCHITECT</p>
          <h1>Configure your quiz.</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Configure up to 10 rounds with custom time limits and point values.
          </p>
        </header>

        <section className="surface-card">
          <div className="field-group">
            <label className="field-label" htmlFor="room-name-input">Room Title</label>
            <input
              id="room-name-input"
              className="input-control"
              autoFocus
              maxLength={60}
              placeholder="e.g. CLOUD CLASH FINALS"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />
          </div>

          <div className="telemetry-strip">
            <div className="telemetry-cell">
              <span>Total Rounds</span>
              <strong>{String(rounds).padStart(2, "0")}</strong>
            </div>
            <div className="telemetry-cell">
              <span>Active Timer</span>
              <strong>{currentSeconds}s / Q</strong>
            </div>
            <div className="telemetry-cell">
              <span>Active Weight</span>
              <strong>{currentMarks} PTS</strong>
            </div>
          </div>

          <div className="round-tabs">
            {Array.from({ length: rounds }, (_, i) => i + 1).map((n) => (
              <button
                type="button"
                key={n}
                className={`round-tab ${activeConfigRound === n ? "active" : ""}`}
                onClick={() => setActiveConfigRound(n)}
              >
                R{String(n).padStart(2, "0")}
              </button>
            ))}
            <button
              type="button"
              className="round-tab-add"
              onClick={addRound}
              disabled={rounds >= 10}
              title={rounds >= 10 ? "Maximum of 10 rounds" : "Add a round"}
            >
              {rounds >= 10 ? "10 Rounds Max" : "+ Add Round"}
            </button>
          </div>

          <div className="round-editor-box">
            <div className="section-header" style={{ marginBottom: 0 }}>
              <div>
                <p className="eyebrow" style={{ marginBottom: 2 }}>
                  ROUND {String(activeConfigRound).padStart(2, "0")} PARAMETERS
                </p>
                <h3 style={{ fontSize: "1rem" }}>Timing & Scoring Rules</h3>
              </div>
              {rounds > 1 && (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => removeRound(activeConfigRound)}
                >
                  Remove
                </button>
              )}
            </div>

            <div className="round-controls-grid">
              <div className="field-group">
                <label className="field-label">Seconds per Question</label>
                <div className="stepper-row">
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() =>
                      setValue("roundSeconds", activeConfigRound, Math.max(5, currentSeconds - 5))
                    }
                  >
                    -5
                  </button>
                  <input
                    type="number"
                    min="5"
                    max="300"
                    className="input-control mono"
                    style={{ textAlign: "center" }}
                    value={currentSeconds}
                    onChange={(e) => setValue("roundSeconds", activeConfigRound, e.target.value)}
                  />
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() =>
                      setValue("roundSeconds", activeConfigRound, Math.min(300, currentSeconds + 5))
                    }
                  >
                    +5
                  </button>
                </div>
                <div className="preset-row">
                  {[15, 25, 45].map((sec) => (
                    <button
                      type="button"
                      key={sec}
                      className={`preset-pill ${currentSeconds === sec ? "active" : ""}`}
                      onClick={() => setValue("roundSeconds", activeConfigRound, sec)}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>

              <div className="field-group">
                <label className="field-label">Points per Correct Answer</label>
                <div className="stepper-row">
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() =>
                      setValue("marks", activeConfigRound, Math.max(1, currentMarks - 5))
                    }
                  >
                    -5
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    className="input-control mono"
                    style={{ textAlign: "center" }}
                    value={currentMarks}
                    onChange={(e) => setValue("marks", activeConfigRound, e.target.value)}
                  />
                  <button
                    type="button"
                    className="stepper-btn"
                    onClick={() =>
                      setValue("marks", activeConfigRound, Math.min(100, currentMarks + 5))
                    }
                  >
                    +5
                  </button>
                </div>
                <div className="preset-row">
                  {[5, 10, 25].map((pt) => (
                    <button
                      type="button"
                      key={pt}
                      className={`preset-pill ${currentMarks === pt ? "active" : ""}`}
                      onClick={() => setValue("marks", activeConfigRound, pt)}
                    >
                      {pt} pts
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="field-group" style={{ marginTop: 16 }}>
              {activeConfigRound < rounds ? (
                <>
                  <label className="field-label" htmlFor="advance-count-input">Participants to keep after Round {activeConfigRound}</label>
                  <div className="stepper-row">
                    <input id="advance-count-input" type="number" min="0" max="500" step="1" className="input-control mono" style={{ maxWidth: 140, textAlign: "center" }} value={settings.advanceCounts?.[activeConfigRound] ?? 0}
                      onChange={(e) => setSettings((current) => ({ ...current, advanceCounts: { ...current.advanceCounts, [activeConfigRound]: Math.min(500, Math.max(0, Math.floor(Number(e.target.value) || 0))) } }))} />
                    <span className="muted">participants</span>
                  </div>
                  <p className="muted" style={{ marginTop: 6, fontSize: "0.78rem" }}>Set 0 to let everyone advance. Tied players at the cutoff are all kept.</p>
                </>
              ) : (
                <p className="muted">Final round: all remaining participants compete. No elimination.</p>
              )}
            </div>
            <div className="field-group" style={{ marginTop: 16 }}>
              <label className="field-label" htmlFor="speed-bonus-input">Maximum Speed Bonus (%)</label>
              <div className="stepper-row">
                <input
                  id="speed-bonus-input"
                  type="number"
                  min="0"
                  max="50"
                  step="1"
                  className="input-control mono"
                  style={{ maxWidth: 140, textAlign: "center" }}
                  value={settings.speedBonusPercent ?? 10}
                  onChange={(e) => setSettings((current) => ({ ...current, speedBonusPercent: Math.min(50, Math.max(0, Number(e.target.value) || 0)) }))}
                />
                <span className="muted">of the question's base points</span>
              </div>
              <p className="muted" style={{ marginTop: 6, fontSize: "0.78rem" }}>
                Correct answers earn up to this extra percentage for answering quickly. The bonus decreases linearly until the timer ends.
              </p>
            </div>
          </div>

          <button type="button" className="btn btn-primary btn-full" style={{ marginTop: 20 }}
            disabled={!connected || !roomName.trim()}
            onClick={create}>
            {roomCode ? "Save Configuration →" : "Create Room & Continue →"}
          </button>
          {roomCode && <button type="button" className="btn btn-secondary btn-full" style={{ marginTop: 10 }}
            onClick={() => setStage("lobby")}>Back to Lobby</button>}
          {error && <div className="error-banner">{error}</div>}
        </section>
      </main>
    );
  }

  /* STAGE 02: AUTHORING METHOD */
  if (stage === "method") {
    return (
      <main className="app-shell">
        <header style={{ marginBottom: 24 }}>
          <p className="eyebrow">STEP 02 · QUESTION AUTHORING</p>
          <h1>{roomName}</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Room Code <strong className="mono" style={{ color: "#22d3ee" }}>{roomCode}</strong> is active. Choose how you want to populate your {rounds} round{rounds === 1 ? "" : "s"}.
          </p>
        </header>

        <section className="method-grid">
          <button type="button" className="method-card" onClick={() => setStage("csv")}>
            <div className="icon-badge">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div>
              <p className="eyebrow">OPTION A · BULK SCHEMA</p>
              <h2 style={{ marginBottom: 6 }}>Upload CSV Templates</h2>
              <p className="muted">
                Download the official CSV template for each round, fill in your questions offline, and upload per round.
              </p>
            </div>
          </button>

          <button
            type="button"
            className="method-card"
            onClick={() => {
              if (!questions.length) setQuestions([blankQuestion()]);
              setStage("manual");
            }}
          >
            <div className="icon-badge">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <div>
              <p className="eyebrow">OPTION B · INTERACTIVE COMPOSER</p>
              <h2 style={{ marginBottom: 6 }}>Add Questions One by One</h2>
              <p className="muted">
                Draft prompts, assign them to specific rounds, mark answer keys, and attach optional explanations.
              </p>
            </div>
          </button>
        </section>

        {error && <div className="error-banner">{error}</div>}
      </main>
    );
  }

  /* STAGE 03A: CSV UPLOAD PER ROUND */
  if (stage === "csv") {
    return (
      <main className="app-shell">
        <button className="back-link" onClick={() => setStage("method")}>
          ← Back to Authoring Method
        </button>

        <header style={{ marginBottom: 24 }}>
          <p className="eyebrow">STEP 03 · ROUND CSV IMPORT</p>
          <h1>Upload round-wise templates.</h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Download the formatted CSV template for each round and upload the completed file. Once all rounds have questions, you will advance to the lobby.
          </p>
        </header>

        <div className="round-upload-list">
          {Array.from({ length: rounds }, (_, i) => i + 1).map((n) => (
            <section className="surface-card" key={n} style={{ marginBottom: 0 }}>
              <div className="section-header">
                <div>
                  <p className="eyebrow" style={{ marginBottom: 2 }}>
                    ROUND {String(n).padStart(2, "0")} · {settings.roundSeconds[n] || 20}S · {settings.marks[n] || 5} PTS
                  </p>
                  <h2>Round {n} Bank</h2>
                </div>
                <span className="status-chip">{counts[n] || 0} loaded</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-full"
                  onClick={() => downloadRoundTemplate(n)}
                >
                  Download Round {n} CSV Template
                </button>
                <label className="upload-dropzone">
                  <span>Upload Round {n} CSV</span>
                  <input type="file" accept=".csv,text/csv" onChange={(e) => uploadRound(e, n)} />
                </label>
              </div>

              <p className="muted" style={{ marginTop: 12, fontSize: "0.8rem" }}>
                {roundUploads[n] ||
                  "Columns: question, option_a, option_b, option_c, option_d, correct_option, explanation"}
              </p>
            </section>
          ))}
        </div>

        {error && <div className="error-banner">{error}</div>}
      </main>
    );
  }

  /* STAGE 03B: MANUAL QUESTION BUILDER */
  if (stage === "manual") {
    return (
      <main className="app-shell">
        <button className="back-link" onClick={() => setStage("method")}>
          ← Back to Authoring Method
        </button>

        <div className="dashboard-head">
          <div>
            <p className="eyebrow">STEP 03 · MANUAL COMPOSER</p>
            <h1>{roomName}</h1>
          </div>
          <span className="status-chip">
            {questions.length} Question{questions.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="builder-toolbar">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.85rem" }}>
            <input
              type="checkbox"
              checked={questions.length > 0 && questions.every((q) => q.selected)}
              onChange={(e) =>
                setQuestions((qs) => qs.map((q) => ({ ...q, selected: e.target.checked })))
              }
            />
            Select All
          </label>
          <div className="button-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!questions.some((q) => q.selected)}
              onClick={() =>
                setQuestions((qs) => [
                  ...qs,
                  ...qs
                    .filter((q) => q.selected)
                    .map((q) => ({ ...q, id: crypto.randomUUID(), selected: false }))
                ])
              }
            >
              Duplicate Selected
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={!questions.some((q) => q.selected)}
              onClick={() => setQuestions((qs) => qs.filter((q) => !q.selected))}
            >
              Delete Selected
            </button>
          </div>
        </div>

        {questions.map((q, i) => (
          <section className="builder-card" key={q.id}>
            <div className="builder-card-top">
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: "0.85rem" }}>
                <input
                  type="checkbox"
                  checked={!!q.selected}
                  onChange={(e) => updateQuestion(i, { selected: e.target.checked })}
                />
                <span className="mono">Q{String(i + 1).padStart(2, "0")}</span>
              </label>
              <span className="builder-badge">Round {q.round}</span>
              <span className="builder-badge">{settings.roundSeconds[q.round] || 20}s</span>
              <span className="builder-badge">{settings.marks[q.round] || 5} pts</span>
              <div style={{ flex: 1 }} />
              <div className="button-group">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={i === 0}
                  onClick={() =>
                    setQuestions((qs) => {
                      const a = [...qs];
                      [a[i - 1], a[i]] = [a[i], a[i - 1]];
                      return a;
                    })
                  }
                >
                  Up
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            </div>

            <div className="builder-card-body">
              <div className="builder-row-grid">
                <div className="field-group">
                  <label className="field-label">Question Prompt</label>
                  <textarea
                    rows="2"
                    className="textarea-control"
                    placeholder="Enter question text..."
                    value={q.text}
                    onChange={(e) => updateQuestion(i, { text: e.target.value })}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Assign Round</label>
                  <select
                    className="select-control"
                    value={q.round}
                    onChange={(e) => updateQuestion(i, { round: Number(e.target.value) })}
                  >
                    {Array.from({ length: rounds }, (_, j) => j + 1).map((n) => (
                      <option value={n} key={n}>
                        Round {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field-group">
                <label className="field-label">Answer Options (Click letter to mark correct)</label>
                <div className="builder-options-grid">
                  {q.options.map((option, j) => (
                    <div
                      className={`builder-option-item ${q.correctOption === j ? "is-correct" : ""}`}
                      key={j}
                    >
                      <button
                        type="button"
                        className="correct-btn"
                        onClick={() => updateQuestion(i, { correctOption: j })}
                      >
                        {String.fromCharCode(65 + j)}
                      </button>
                      <input
                        placeholder={`Option ${String.fromCharCode(65 + j)}`}
                        value={option}
                        onChange={(e) =>
                          updateQuestion(i, {
                            options: q.options.map((v, k) => (k === j ? e.target.value : v))
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="field-group">
                <label className="field-label">Explanation (Optional)</label>
                <textarea
                  rows="2"
                  className="textarea-control"
                  placeholder="Clarify why the selected option is correct..."
                  value={q.explanation}
                  onChange={(e) => updateQuestion(i, { explanation: e.target.value })}
                />
              </div>
            </div>
          </section>
        ))}

        <button
          type="button"
          className="add-question-dashed"
          onClick={() => setQuestions((qs) => [...qs, blankQuestion(1)])}
        >
          + ADD NEW QUESTION
        </button>

        {error && <div className="error-banner">{error}</div>}

        <div className="sticky-footer">
          <div className="sticky-footer-inner">
            <span className="mono muted">
              {questions.length} QUESTIONS · {rounds} ROUNDS
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                !questions.length ||
                questions.some((q) => !q.text.trim() || q.options.some((o) => !o.trim()))
              }
              onClick={saveManual}
            >
              Save Questions & Continue →
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* IDLE / RESET STATE */
  if (status === "idle" || (status === "finished" && !roomCode)) {
    return (
      <main className="app-shell narrow">
        <section className="surface-card">
          <p className="eyebrow">HOST CONTROL ROOM</p>
          <h1>Ready for a new session.</h1>
          <button
            type="button"
            className="btn btn-primary btn-full"
            style={{ marginTop: 18 }}
            onClick={() => setStage("room")}
          >
            Create Room
          </button>
        </section>
      </main>
    );
  }

  const totalRoundSeconds = settings.roundSeconds[round] || 20;
  const progressPct = question ? Math.min(100, Math.max(0, (seconds / totalRoundSeconds) * 100)) : 0;
  const timerState = seconds <= 5 ? "urgent" : seconds <= 10 ? "warning" : "";

  /* STAGE 04: LIVE HOST CONTROL ROOM */
  return (
    <main className="app-shell">
      <header className="dashboard-head">
        <div>
          <p className="eyebrow">HOST CONTROL ROOM</p>
          <h1>{roomName || "Live Arena"}</h1>
        </div>
        <span className={`status-chip ${status}`}>{status.replace("_", " ")}</span>
      </header>

      <section className="room-banner">
        <div>
          <p className="eyebrow" style={{ marginBottom: 4 }}>ROOM ACCESS CODE</p>
          <div className="room-code-display">{roomCode}</div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={copyCode}>
          {copied ? "Copied to Clipboard" : "Copy Room Code"}
        </button>
      </section>

      {importStatus && status === "waiting" && (
        <div className="success-banner" style={{ marginBottom: 16 }}>
          {importStatus}
        </div>
      )}

      {status === "waiting" && (
        <div className="host-lobby-grid">
          <section className="surface-card">
            <div className="section-header">
              <div>
                <p className="eyebrow" style={{ marginBottom: 2 }}>QUESTION BANK</p>
                <h2>Round Overview</h2>
              </div>
              <span className="mono muted">{rounds} Rounds</span>
            </div>

            <div className="standings-list">
              {Array.from({ length: rounds }, (_, i) => i + 1).map((n) => (
                <div className="standing-row" key={n}>
                  <div>
                    <strong>Round {String(n).padStart(2, "0")}</strong>
                    <p className="muted" style={{ fontSize: "0.78rem" }}>
                      {settings.roundSeconds[n] || 20}s timer · {settings.marks[n] || 5} pts/Q · {n < rounds && (settings.advanceCounts?.[n] ? `keep top ${settings.advanceCounts[n]}` : "no elimination")}
                    </p>
                  </div>
                  <span className="standing-score">{counts[n] || 0} Qs</span>
                </div>
              ))}
            </div>

            <button type="button" className="btn btn-secondary btn-full" style={{ marginTop: 16 }}
              onClick={() => setStage("advanced")}>
              Configure Quiz Settings
            </button>
            <button type="button" className="btn btn-secondary btn-full" style={{ marginTop: 10 }}
              onClick={() => setStage("method")}>
              Edit Question Bank
            </button>
          </section>

          <section className="surface-card">
            <div className="section-header">
              <div>
                <p className="eyebrow" style={{ marginBottom: 2 }}>WAITING LOBBY</p>
                <h2>Connected Players</h2>
              </div>
              <span className="status-chip">{participants.length} Joined</span>
            </div>

            {participants.length > 0 ? (
              <div className="roster-grid">
                {participants.map((p) => (
                  <div className="player-chip" key={p.id}>
                    <span className="avatar-monogram">{getInitials(p.name)}</span>
                    <span className="player-chip-name">{p.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted" style={{ padding: "18px 0" }}>
                Share code <strong className="mono">{roomCode}</strong> with players to populate the lobby.
              </p>
            )}

            {Array.from({ length: rounds }, (_, i) => i + 1).some((n) => !counts[n]) && (
              <div className="error-banner">
                Missing questions for:{" "}
                {Array.from({ length: rounds }, (_, i) => i + 1)
                  .filter((n) => !counts[n])
                  .map((n) => `Round ${n}`)
                  .join(", ")}
                .
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary btn-full"
              style={{ marginTop: 16 }}
              disabled={
                !participants.length ||
                Array.from({ length: rounds }, (_, i) => i + 1).some((n) => !counts[n])
              }
              onClick={() => action("start_quiz")}
            >
              Start Live Match →
            </button>
            <button type="button" className="btn btn-danger btn-full" style={{ marginTop: 10 }}
              onClick={() => {
                if (!window.confirm("Cancel this quiz room? All connected participants will be removed and the room code will stop working.")) return;
                action("cancel_quiz", undefined, () => onHome());
              }}>
              Exit & Cancel Quiz
            </button>
          </section>
        </div>
      )}

      {(status === "running" || status === "paused") && (
        <section className="arena-card">
          <div className="timer-track">
            <div
              className={`timer-fill ${timerState}`}
              style={{ width: `${status === "paused" ? 100 : progressPct}%` }}
            />
          </div>

          <div className="question-hud">
            <span className="hud-badge">
              ROUND {String(round).padStart(2, "0")} · QUESTION {question?.questionNumber || "—"}/
              {question?.totalQuestions || "—"} · {question?.marks || settings.marks[round]} PTS
            </span>
            <span className={`timer-readout ${timerState}`}>
              {status === "paused" ? "PAUSED" : `${seconds}s`}
            </span>
          </div>

          <h2 className="question-prompt">
            {status === "paused"
              ? "Match paused by host"
              : question?.text || "Preparing next question..."}
          </h2>

          {question && (
            <div className="options-grid">
              {question.options.map((o, i) => (
                <div className="option-tile host-readonly" key={i}>
                  <span className="option-key">{String.fromCharCode(65 + i)}</span>
                  <span>{o}</span>
                </div>
              ))}
            </div>
          )}

          <div className="host-controls-bar">
            <span className="muted" style={{ fontSize: "0.82rem" }}>
              {status === "paused"
                ? "Player timers are frozen."
                : "Advances automatically when timer reaches 0s."}
            </span>
            <div className="button-group">
              {status === "running" ? (
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={() => action("pause_quiz")}
                >
                  Pause Quiz
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => action("resume_quiz")}
                >
                  Resume Quiz
                </button>
              )}
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (window.confirm("End this quiz for everyone?")) action("end_quiz");
                }}
              >
                End Quiz
              </button>
            </div>
          </div>
        </section>
      )}

      {status === "round_break" && (
        <section className="surface-card">
          <p className="eyebrow">ROUND {String(round).padStart(2, "0")} COMPLETE</p>
          <h2>Interim Standings Locked</h2>
          <p className="muted" style={{ margin: "6px 0 18px" }}>
            Review the current rankings below before advancing the room.
          </p>
          {roundElimination?.eliminatedCandidates?.length > 0 && !eliminationsConfirmed && (
            <div className="surface-card" style={{ margin: "14px 0", padding: 14 }}>
              <p className="eyebrow">ELIMINATION REVIEW</p>
              <h3 style={{ marginBottom: 6 }}>Keep top {roundElimination.keepCount}</h3>
              <p className="muted" style={{ marginBottom: 10 }}>{roundElimination.advancingCount} participants will advance. Review the players below before confirming.</p>
              <div className="standings-list">
                {roundElimination.eliminatedCandidates.map((p) => (
                  <div className="standing-row" key={p.id}>
                    <strong>{p.name}</strong>
                    <span className="standing-score">{Number(p.score).toFixed(2)} pts</span>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-danger btn-full" style={{ marginTop: 12 }} onClick={() => action("confirm_eliminations")}>
                Confirm Elimination ({roundElimination.eliminatedCandidates.length})
              </button>
            </div>
          )}
          {roundElimination?.eliminatedCandidates?.length > 0 && eliminationsConfirmed && (
            <p className="success-banner">Eliminations confirmed. {roundElimination.advancingCount} participants advance.</p>
          )}
          <button type="button" className="btn btn-primary btn-full" disabled={!eliminationsConfirmed} onClick={() => action("start_next_round")}>
            {round < rounds ? `Start Round ${String(round + 1).padStart(2, "0")} →` : "Finish Quiz & Reveal Podium →"}
          </button>
        </section>
      )}

      {(status === "round_break" || status === "finished") && (
        <section className="surface-card">
          <p className="eyebrow">TELEMETRY STANDINGS</p>
          <h2>{status === "finished" ? "Final Podium & Leaderboard" : "Current Leaderboard"}</h2>

          {leaderboard.length >= 3 && (
            <div className="podium-grid">
              {[leaderboard[1], leaderboard[0], leaderboard[2]].map((p, idx) => {
                const actualRank = idx === 0 ? 2 : idx === 1 ? 1 : 3;
                return (
                  <div className={`podium-slot rank-${actualRank}`} key={p.id}>
                    <span className="podium-rank">#{String(actualRank).padStart(2, "0")}</span>
                    <span className="avatar-monogram">{getInitials(p.name)}</span>
                    <span className="podium-name">{p.name}</span>
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
                  <strong>{p.name} {p.eliminated ? "(Eliminated)" : ""}</strong>
                </div>
                <span className="standing-score">{Number(p.score).toFixed(2)} pts</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {status === "finished" && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setRoomCode("");
            setStatus("idle");
            setStage("room");
          }}
        >
          Create Another Quiz
        </button>
      )}

      {error && <div className="error-banner">{error}</div>}
    </main>
  );
}