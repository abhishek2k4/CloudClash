import { useCallback, useEffect, useState } from "react";
import { socket } from "../../services/socket";
import { getSession } from "../../services/auth";


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
    eliminationEnabled: false,
    advanceCounts: { 1: 0, 2: 0 }
  });
  const [participants, setParticipants] = useState([]);
  const [counts, setCounts] = useState({});
  const [round, setRound] = useState(0);
  const [question, setQuestion] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [resultsRevealed, setResultsRevealed] = useState(false);
  const [leaderboardView, setLeaderboardView] = useState("overall");
  const [leaderboardRound, setLeaderboardRound] = useState(1);
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);
  const [roundElimination, setRoundElimination] = useState(null);
  const [eliminationsConfirmed, setEliminationsConfirmed] = useState(true);
  const [questions, setQuestions] = useState([blankQuestion()]);
  const [error, setError] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [roundUploads, setRoundUploads] = useState({});
  const [roundFilenames, setRoundFilenames] = useState({});
  const [copied, setCopied] = useState(false);
  const [archives, setArchives] = useState([]);
  const [archivesLoading, setArchivesLoading] = useState(false);
  const [archivesError, setArchivesError] = useState("");
  const [expandedArchiveId, setExpandedArchiveId] = useState(null);
  const [archivesVersion, setArchivesVersion] = useState(0);

  const apply = useCallback((response) => {
    if (!response?.success) {
      setError(response?.message || "Could not open host controls.");
      return;
    }
    setAuthenticated(true);

    // A finished quiz belongs to the previous host session. A new visit to
    // /host should start with a clean setup screen, not reopen its leaderboard.
    // Active/waiting rooms still restore their control dashboard for host recovery.
    if (response.status === "finished" && !response.roomCode) {
      setRoomCode("");
      setRoomName("");
      setStatus("idle");
      setRounds(2);
      setActiveConfigRound(1);
      setSettings({
        roundSeconds: { 1: 15, 2: 25 },
        marks: { 1: 10, 2: 20 }
      });
      setParticipants([]);
      setCounts({});
      setRound(0);
      setQuestion(null);
      setLeaderboard([]);
      setQuestions([blankQuestion()]);
      setImportStatus("");
      setRoundUploads({});
      setStage("room");
      return;
    }

    setRoomCode(response.roomCode || "");
    setRoomName(response.roomName || "");
    setStatus(response.status || "idle");
    setRounds(response.rounds || 2);
    if (response.quizSettings) setSettings({
      ...response.quizSettings,
      eliminationEnabled: response.quizSettings.eliminationEnabled ?? false
    });
    setParticipants(response.participants || []);
    setCounts(response.questionCounts || {});
    setRound(response.round || 0);
    setQuestion(response.question || null);
    setLeaderboard(response.leaderboard || []);
    setResultsRevealed(Boolean(response.resultsRevealed));
    setExpandedPlayerId(response.leaderboard?.[0]?.id || null);
    setEliminationsConfirmed(response.eliminationsConfirmed ?? true);
    if (response.status === "round_break") {
      const pending = response.pendingEliminationIds || [];
      const board = response.leaderboard || [];
      setRoundElimination({ keepCount: response.quizSettings?.advanceCounts?.[response.round] || null, advancingCount: board.filter((p) => !p.eliminated).length - pending.length, eliminatedCandidates: board.filter((p) => pending.includes(p.id)) });
    }
    // Restore an existing waiting/live session for host recovery.
    setStage(response.roomCode ? "control" : "room");
  }, []);

  useEffect(() => {
    socket.auth = (callback) => {
      getSession().then((current) => callback(current?.accessToken ? { accessToken: current.accessToken } : {})).catch(() => callback({}));
    };
    const connect = () => {
      setConnected(true);
      socket.emit("host_login", apply);
    };
    const disconnect = () => setConnected(false);
    const onConnectError = (err) => {
      setConnected(false);
      setError(err?.message || "Could not verify your account session.");
    };
    const onPeople = setParticipants;
    const onLeaderboard = setLeaderboard;
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
      setExpandedPlayerId(d.leaderboard?.[0]?.id || null);
      setRoundElimination(d);
      setEliminationsConfirmed(d.eliminationsConfirmed ?? true);
      setStatus("round_break");
      setQuestion(null);
    };
    const onEliminationsConfirmed = (d) => {
      setLeaderboard(d.leaderboard || []);
      setEliminationsConfirmed(true);
      setRoundElimination((current) => current ? { ...current, eliminatedCandidates: [], advancingCount: d.advancingCount } : current);
    };
    const onArchiveSaved = () => setArchivesVersion((v) => v + 1);
    const onArchiveError = (d) => setArchivesError(d?.message || "Could not save this quiz to your archive.");
    const onFinish = (d) => {
      setLeaderboard([]);
      setResultsRevealed(false);
      setStatus("finished");
      setQuestion(null);
    };
    const onRevealFinal = (d) => {
      setLeaderboard(d.leaderboard || []);
      setResultsRevealed(true);
      setExpandedPlayerId(d.leaderboard?.[0]?.id || null);
    };

    socket.on("connect", connect);
    socket.on("disconnect", disconnect);
    socket.on("connect_error", onConnectError);
    socket.on("participants_updated", onPeople);
    socket.on("leaderboard_updated", onLeaderboard);
    socket.on("competition_status_updated", onStatus);
    socket.on("question_started", onQuestion);
    socket.on("question_resumed", onResume);
    socket.on("question_ended", onEnded);
    socket.on("round_started", onRound);
    socket.on("round_finished", onBreak);
    socket.on("eliminations_confirmed", onEliminationsConfirmed);
    socket.on("competition_finished", onFinish);
    socket.on("quiz_archived", onArchiveSaved);
    socket.on("quiz_archive_error", onArchiveError);
    socket.on("final_leaderboard_revealed", onRevealFinal);
    socket.connect();

    return () => {
      socket.off("connect", connect);
      socket.off("disconnect", disconnect);
      socket.off("connect_error", onConnectError);
      socket.off("participants_updated", onPeople);
      socket.off("leaderboard_updated", onLeaderboard);
      socket.off("competition_status_updated", onStatus);
      socket.off("question_started", onQuestion);
      socket.off("question_resumed", onResume);
      socket.off("question_ended", onEnded);
      socket.off("round_started", onRound);
      socket.off("round_finished", onBreak);
      socket.off("eliminations_confirmed", onEliminationsConfirmed);
      socket.off("competition_finished", onFinish);
      socket.off("quiz_archived", onArchiveSaved);
      socket.off("quiz_archive_error", onArchiveError);
      socket.off("final_leaderboard_revealed", onRevealFinal);
      socket.disconnect();
      socket.auth = {};
    };
  }, [apply]);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    setArchivesLoading(true);
    setArchivesError("");
    getSession().then(async (current) => {
      if (!current?.accessToken) throw new Error("Please sign in again to load your quiz archives.");
      const response = await fetch(`${import.meta.env.VITE_SERVER_URL}/api/archives`, {
        headers: { Authorization: `Bearer ${current.accessToken}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not load quiz archives.");
      if (!cancelled) setArchives(Array.isArray(payload.archives) ? payload.archives : []);
    }).catch((err) => {
      if (!cancelled) setArchivesError(err.message || "Could not load quiz archives.");
    }).finally(() => {
      if (!cancelled) setArchivesLoading(false);
    });
    return () => { cancelled = true; };
  }, [authenticated, archivesVersion]);

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
    if (target !== rounds) {
      setError("Only the last round can be removed. Select the final round first.");
      return;
    }
    if (Number(counts[target] || 0) > 0) {
      setError("Remove the questions from Round " + target + " in the question bank before removing this round.");
      return;
    }
    setError("");
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
    const defaults = {
      roomName,
      rounds,
      roundSeconds: Object.fromEntries(Array.from({ length: rounds }, (_, i) => [i + 1, 20])),
      marks: Object.fromEntries(Array.from({ length: rounds }, (_, i) => [i + 1, 10])),
      speedBonusPercent: 10,
      eliminationEnabled: false,
      advanceCounts: Object.fromEntries(Array.from({ length: rounds }, (_, i) => [i + 1, 0]))
    };
    action("create_quiz", defaults, (r) => {
      setRoomCode(r.roomCode);
      setCounts(r.questionCounts);
      setRoomName(r.roomName);
      if (r.quizSettings) setSettings({
        ...r.quizSettings,
        eliminationEnabled: r.quizSettings.eliminationEnabled ?? false
      });
      setStatus("waiting");
      setStage("method");
    });
  };

  const saveAdvancedConfig = () => {
    const payload = {
      roomName,
      rounds,
      roundSeconds: settings.roundSeconds,
      marks: settings.marks,
      speedBonusPercent: settings.speedBonusPercent ?? 10,
      eliminationEnabled: settings.eliminationEnabled ?? false,
      advanceCounts: settings.advanceCounts ?? {}
    };
    action("update_quiz_config", payload, (r) => {
      setRounds(r.rounds);
      setSettings({
        ...r.quizSettings,
        eliminationEnabled: r.quizSettings.eliminationEnabled ?? false
      });
      setCounts(r.questionCounts);
      setStage("lobby");
      setImportStatus("Advanced configuration saved.");
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

  const downloadRoundTemplate = () => {
    const csv = "question,option_a,option_b,option_c,option_d,correct_option,explanation\\r\\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\\uFEFF" + csv], { type: "text/csv" }));
    a.download = "cloud-clash-questions-template.csv";
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
        setRoundFilenames((s) => ({ ...s, [n]: file.name }));
        setRoundUploads((s) => ({ ...s, [n]: "" }));
        setImportStatus(`Round ${n} question bank uploaded.`);
      }, () => {
        setRoundUploads((s) => ({ ...s, [n]: "Upload failed — check the CSV headers and format" }));
      });
    } catch {
      setError("Could not read the CSV file.");
      setRoundUploads((s) => ({ ...s, [n]: "Upload failed" }));
    }
    e.target.value = "";
  };

  const discardRoundUpload = (n) => {
    if (!window.confirm(`Discard all ${counts[n] || 0} questions uploaded for Round ${n}?`)) return;
    setError("");
    setRoundUploads((s) => ({ ...s, [n]: "Discarding..." }));
    action("discard_round_questions", { round: n }, (r) => {
      setCounts(r.counts);
      setRoundUploads((s) => ({ ...s, [n]: "" }));
      setRoundFilenames((s) => ({ ...s, [n]: "" }));
      setImportStatus(`Round ${n} upload discarded.`);
    }, () => {
      setRoundUploads((s) => ({ ...s, [n]: "Could not discard upload. Please try again." }));
    });
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!authenticated) {
    return (
      <main className="host-initializing-screen">
        <header className="host-initializing-topbar">
          <button type="button" className="host-home-link" onClick={requestHome}>← Home</button>
          <a className="host-initializing-brand" href="/" aria-label="CloudClash home" onClick={(event) => { event.preventDefault(); requestHome(); }}>
            <img src="/assets/cloudclash/branding/logo-mark.svg" alt="" />
            <span>CLOUD<span>CLASH</span></span>
          </a>
        </header>
        <section className="host-initializing-card" role="status" aria-live="polite">
          <span className="host-initializing-spinner" aria-hidden="true" />
          <p className="host-initializing-label">HOST SETUP</p>
          <h1>Initializing <span>Control Room.</span></h1>
          <p className="host-initializing-description">
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
      <main className="host-setup-screen">
        <div className="host-flow-topbar">
          <button className="host-flow-back" onClick={requestHome}>← Back to Home</button>
          <a className="host-flow-brand" href="/" aria-label="CloudClash home" onClick={(event) => { event.preventDefault(); requestHome(); }}>
            <img src="/assets/cloudclash/branding/logo-mark.svg" alt="" />
            <span>CLOUD<span>CLASH</span></span>
          </a>
        </div>
        <div className="host-setup-content">
        <header className="host-flow-heading">
          <p className="host-flow-step">STEP 01 · ROOM SETUP</p>
          <h1>Create your <span>quiz.</span></h1>
          <p>Set up the room first. You can configure quiz rules from the host dashboard after creating it.</p>
        </header>
        <section className="host-flow-card host-room-form">
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
          <p className="muted" style={{ fontSize: "0.82rem" }}>Round timers, scoring, speed bonuses and optional elimination can be adjusted later from the host dashboard.</p>
          {error && <div className="error-banner">{error}</div>}
          <button
            type="button"
            className="btn btn-primary btn-full"
            style={{ marginTop: 18 }}
            disabled={!connected || !roomName.trim()}
            onClick={create}
          >
            Create Room & Continue →
          </button>
        </section>

        <section className="host-flow-card host-history-card">
          <div className="host-history-heading">
            <div><p className="host-flow-step">YOUR HISTORY</p><h2>Previous quizzes</h2></div>
            <span className="host-history-count">{archives.length}/5 SAVED</span>
          </div>
          {archivesLoading && <p className="muted">Loading your quiz archives...</p>}
          {archivesError && <div className="error-banner">{archivesError}</div>}
          {!archivesLoading && !archivesError && archives.length === 0 && <p className="muted">Completed quizzes will appear here. Your five most recent quizzes are kept automatically.</p>}
          <div className="standings-list">
            {archives.map((archive) => {
              const expanded = expandedArchiveId === archive.id;
              const board = Array.isArray(archive.leaderboard) ? archive.leaderboard : [];
              return (
                <article key={archive.id} className="host-archive-item">
                  <button type="button" onClick={() => setExpandedArchiveId(expanded ? null : archive.id)} aria-expanded={expanded}
                    className="host-archive-toggle">
                    <span><strong>{archive.room_name || "Untitled quiz"}</strong><span className="muted" style={{ display: "block", fontSize: "0.78rem", marginTop: 4 }}>{new Date(archive.completed_at).toLocaleDateString()} · {archive.rounds} rounds · {archive.participant_count} players</span></span>
                    <span className="host-archive-expand">{expanded ? "−" : "+"}</span>
                  </button>
                  {expanded && <div style={{ marginTop: 12 }}>
                    {board.length ? board.map((player) => (
                      <div key={player.id} className="standing-row" style={{ padding: "7px 0" }}>
                        <span><strong>#{player.rank}</strong> {player.name}{player.eliminated ? " · Eliminated" : ""}</span>
                        <span className="standing-score">{Number(player.score || 0).toFixed(2)} pts</span>
                      </div>
                    )) : <p className="muted">No leaderboard was recorded for this quiz.</p>}
                  </div>}
                </article>
              );
            })}
          </div>
        </section>
        </div>
      </main>
    );
  }

  /* ADVANCED QUIZ CONFIGURATION */
  if (stage === "advanced") {
    const currentSeconds = settings.roundSeconds[activeConfigRound] ?? 20;
    const currentMarks = settings.marks[activeConfigRound] ?? 10;
    const bestCase = currentMarks * (1 + (settings.speedBonusPercent ?? 10) / 100);
    const activeRoundLabel = `Round ${String(activeConfigRound).padStart(2, "0")}`;

    return (
      <main className="host-config-screen">
        <header className="host-config-topbar">
          <button className="host-config-brand" type="button" onClick={requestHome} aria-label="Back to CloudClash home">
            <img src="/assets/cloudclash/branding/logo-mark.svg" alt="" />
            <span>CLOUD<span>CLASH</span></span>
          </button>
          <div className="host-config-topbar-meta">
            <span className="host-config-status"><i /> HOST CONTROL ROOM</span>
            <span className="host-config-state">{status === "waiting" ? "CONFIGURING" : status.toUpperCase()}</span>
          </div>
        </header>

        <div className="host-config-content">
          <button className="host-config-back" type="button" onClick={() => setStage("lobby")}>← Back to Host Dashboard</button>
          <header className="host-config-heading">
            <p className="eyebrow">HOST CONTROL ROOM · ADVANCED SETTINGS</p>
            <h1>Configure your quiz<span>.</span></h1>
            <p>Fine-tune round timing, scoring and optional elimination before the quiz begins.</p>
          </header>

          <section className="host-config-metrics" aria-label="Current configuration summary">
            <article><span>Total Rounds</span><strong>{String(rounds).padStart(2, "0")}</strong></article>
            <article><span>Active Timer</span><strong>{currentSeconds}s / Q</strong></article>
            <article><span>Active Weight</span><strong>{currentMarks} PTS</strong></article>
          </section>

          <div className="host-config-layout">
            <section className="host-config-editor">
              <div className="host-config-round-tabs" aria-label="Select round to configure">
                {Array.from({ length: rounds }, (_, i) => i + 1).map((n) => (
                  <button type="button" key={n} className={activeConfigRound === n ? "active" : ""}
                    aria-pressed={activeConfigRound === n} onClick={() => setActiveConfigRound(n)}>
                    R{String(n).padStart(2, "0")}
                  </button>
                ))}
                <button type="button" className="add-round" onClick={addRound} disabled={rounds >= 10}>
                  + Add Round
                </button>
              </div>

              <div className="host-config-section-heading">
                <div><p className="eyebrow">{activeRoundLabel} PARAMETERS</p><h2>Timing &amp; Scoring Rules</h2></div>
                {rounds > 1 && <button type="button" className="host-config-remove" disabled={activeConfigRound !== rounds} title={activeConfigRound !== rounds ? "Select the last round to remove it" : "Remove the last round"} onClick={() => removeRound(activeConfigRound)}>Remove</button>}
              </div>

              <div className="host-config-controls">
                <div className="host-config-field">
                  <label htmlFor="config-seconds">Seconds per question</label>
                  <div className="host-config-stepper">
                    <button type="button" aria-label="Decrease timer by 5 seconds" onClick={() => setValue("roundSeconds", activeConfigRound, Math.max(5, currentSeconds - 5))}>-5</button>
                    <input id="config-seconds" type="number" min="5" max="300" value={currentSeconds}
                      onChange={(e) => setValue("roundSeconds", activeConfigRound, e.target.value)} />
                    <button type="button" aria-label="Increase timer by 5 seconds" onClick={() => setValue("roundSeconds", activeConfigRound, Math.min(300, currentSeconds + 5))}>+5</button>
                  </div>
                  <div className="host-config-presets">
                    {[10, 15, 25, 45].map((sec) => <button type="button" key={sec}
                      className={currentSeconds === sec ? "active" : ""} onClick={() => setValue("roundSeconds", activeConfigRound, sec)}>{sec}s</button>)}
                  </div>
                </div>

                <div className="host-config-field">
                  <label htmlFor="config-marks">Points per correct answer</label>
                  <div className="host-config-stepper">
                    <button type="button" aria-label="Decrease points by 5" onClick={() => setValue("marks", activeConfigRound, Math.max(1, currentMarks - 5))}>-5</button>
                    <input id="config-marks" type="number" min="1" max="100" value={currentMarks}
                      onChange={(e) => setValue("marks", activeConfigRound, e.target.value)} />
                    <button type="button" aria-label="Increase points by 5" onClick={() => setValue("marks", activeConfigRound, Math.min(100, currentMarks + 5))}>+5</button>
                  </div>
                  <div className="host-config-presets">
                    {[5, 10, 25, 50].map((pt) => <button type="button" key={pt}
                      className={currentMarks === pt ? "active" : ""} onClick={() => setValue("marks", activeConfigRound, pt)}>{pt} pts</button>)}
                  </div>
                </div>
              </div>

              <label className="host-config-elimination">
                <span><strong>Enable participant elimination</strong><small>Optional. When disabled, every participant advances through all rounds.</small></span>
                <input type="checkbox" checked={!!settings.eliminationEnabled}
                  onChange={(e) => setSettings((current) => ({ ...current, eliminationEnabled: e.target.checked }))} />
                <i aria-hidden="true" />
              </label>

              <div className="host-config-advance">
                <span className="host-config-chip">{activeConfigRound === rounds ? "FINAL ROUND" : "ROUND ADVANCE"}</span>
                {settings.eliminationEnabled && activeConfigRound < rounds ? (
                  <div className="host-config-keep">
                    <label htmlFor="advance-count-input">Participants to keep after this round</label>
                    <input id="advance-count-input" type="number" min="0" max="500" step="1"
                      value={settings.advanceCounts?.[activeConfigRound] ?? 0}
                      onChange={(e) => setSettings((current) => ({ ...current, advanceCounts: { ...current.advanceCounts, [activeConfigRound]: Math.min(500, Math.max(0, Math.floor(Number(e.target.value) || 0))) } }))} />
                    <small>Set 0 to let everyone advance. Tied players at the cutoff are all kept.</small>
                  </div>
                ) : <p>{activeConfigRound === rounds ? "All remaining participants compete. No elimination." : "All participants advance to the next round."}</p>}
              </div>

              <div className="host-config-speed">
                <label htmlFor="speed-bonus-input">Maximum speed bonus (%)</label>
                <div className="host-config-speed-row">
                  <input id="speed-bonus-input" type="number" min="0" max="50" step="1"
                    value={settings.speedBonusPercent ?? 10}
                    onChange={(e) => setSettings((current) => ({ ...current, speedBonusPercent: Math.min(50, Math.max(0, Number(e.target.value) || 0)) }))} />
                  <input aria-label="Maximum speed bonus percentage" type="range" min="0" max="50" step="1"
                    value={settings.speedBonusPercent ?? 10}
                    onChange={(e) => setSettings((current) => ({ ...current, speedBonusPercent: Number(e.target.value) }))} />
                </div>
                <p>Correct answers earn up to this extra percentage for answering quickly. The bonus decreases linearly until the timer ends.</p>
              </div>
            </section>

            <aside className="host-config-preview">
              <p className="eyebrow">LIVE PREVIEW</p>
              <div className="host-config-preview-title"><h2>Round Overview</h2><span>{rounds} Rounds</span></div>
              <div className="host-config-round-list">
                {Array.from({ length: rounds }, (_, i) => i + 1).map((n) => (
                  <button type="button" key={n} className={activeConfigRound === n ? "active" : ""}
                    onClick={() => setActiveConfigRound(n)}>
                    <span><strong>Round {String(n).padStart(2, "0")}</strong><small>{settings.roundSeconds[n] ?? 20}s timer · {settings.marks[n] ?? 10} pts/Q{n < rounds && settings.eliminationEnabled ? ` · keep top ${settings.advanceCounts?.[n] || "all"}` : ""}</small></span>
                    {activeConfigRound === n && <b>EDITING</b>}
                  </button>
                ))}
              </div>
              <div className="host-config-best-case">
                <span>BEST CASE PER QUESTION · ROUND {String(activeConfigRound).padStart(2, "0")}</span>
                <strong>{bestCase.toFixed(1)} pts</strong>
                <p>{currentMarks} base + up to {(bestCase - currentMarks).toFixed(1)} for a fast correct answer.</p>
              </div>
              <button type="button" className="host-config-save" disabled={!connected || !roomCode} onClick={saveAdvancedConfig}>
                Save Advanced Configuration →
              </button>
              {error && <div className="error-banner">{error}</div>}
            </aside>
          </div>
        </div>
      </main>
    );
  }

  if (stage === "method") {
    return (
      <main className="host-method-screen">
        <div className="host-flow-topbar">
          <button className="host-flow-back" onClick={() => setStage("lobby")}>← Back to Host Dashboard</button>
          <a className="host-flow-brand" href="/" aria-label="CloudClash home" onClick={(event) => { event.preventDefault(); requestHome(); }}>
            <img src="/assets/cloudclash/branding/logo-mark.svg" alt="" />
            <span>CLOUD<span>CLASH</span></span>
          </a>
        </div>
        <div className="host-method-content">
        <header className="host-flow-heading host-method-heading">
          <p className="host-flow-step">STEP 02 · QUESTION AUTHORING</p>
          <h1>{roomName}<span className="host-title-period">.</span></h1>
          <p>Room Code <strong className="host-room-code">{roomCode}</strong> is active. Choose how you want to populate your {rounds} round{rounds === 1 ? "" : "s"}.</p>
        </header>

        <section className="host-method-grid">
          <button type="button" className="method-card" onClick={() => setStage("csv")}>
            <div className="host-method-icon">
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
            <div className="host-method-icon">
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
        </div>
      </main>
    );
  }

  /* STAGE 03A: CSV UPLOAD PER ROUND */
  if (stage === "csv") {
    return (
      <main className="host-csv-screen">
        <div className="host-flow-topbar">
          <button className="host-flow-back" onClick={() => setStage("method")}>← Back to Authoring Method</button>
          <a className="host-flow-brand" href="/" aria-label="CloudClash home" onClick={(event) => { event.preventDefault(); requestHome(); }}>
            <img src="/assets/cloudclash/branding/logo-mark.svg" alt="" />
            <span>CLOUD<span>CLASH</span></span>
          </a>
        </div>
        <div className="host-csv-content">
        <header className="host-flow-heading host-csv-heading">
          <p className="host-flow-step">STEP 03 · ROUND CSV IMPORT</p>
          <h1>Upload questions by <span>round.</span></h1>
          <p>Download the shared CSV template, then upload a completed file separately for each round. Once all rounds have questions, you will advance to the lobby.</p>
        </header>

        <section className="host-flow-card host-csv-template-card">
          <div className="section-header" style={{ marginBottom: 12 }}>
            <div>
              <p className="eyebrow" style={{ marginBottom: 2 }}>SHARED FORMAT</p>
              <h2>CSV Question Template</h2>
            </div>
            <span className="status-chip">All rounds</span>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-full"
            onClick={downloadRoundTemplate}
          >
            Download CSV Template
          </button>
          <p className="muted" style={{ marginTop: 12, fontSize: "0.8rem" }}>
            Columns: question, option_a, option_b, option_c, option_d, correct_option, explanation
          </p>
        </section>

        <div className="round-upload-list">
          {Array.from({ length: rounds }, (_, i) => i + 1).map((n) => (
            <section className="host-flow-card host-round-bank-card" key={n}>
              <div className="section-header">
                <div>
                  <p className="eyebrow" style={{ marginBottom: 2 }}>
                    ROUND {String(n).padStart(2, "0")} · {settings.roundSeconds[n] || 20}S · {settings.marks[n] || 5} PTS
                  </p>
                  <h2>Round {n} Bank</h2>
                </div>
                <span className="status-chip">
                  {counts[n] > 0 ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#22c55e" }}>
                      <span aria-hidden="true" style={{ fontWeight: 800, fontSize: "1rem" }}>✓</span>
                      {counts[n]} loaded
                    </span>
                  ) : "0 loaded"}
                </span>
              </div>

              <label className="upload-dropzone">
                <span>{counts[n] > 0 ? `Replace Round ${n} CSV` : `Upload Round ${n} CSV`}</span>
                <input type="file" accept=".csv,text/csv" onChange={(e) => uploadRound(e, n)} />
              </label>

              {counts[n] > 0 && (
                <button
                  type="button"
                  className="btn btn-danger btn-full"
                  style={{ marginTop: 10 }}
                  disabled={roundUploads[n] === "Discarding..."}
                  onClick={() => discardRoundUpload(n)}
                >
                  {roundUploads[n] === "Discarding..." ? "Discarding..." : "Discard uploaded questions"}
                </button>
              )}

              {roundFilenames[n] && counts[n] > 0 && (
                <p className="muted" style={{ marginTop: 12, fontSize: "0.8rem", overflowWrap: "anywhere" }}>
                  <span style={{ color: "var(--text-muted, #94a3b8)" }}>File: </span>
                  {roundFilenames[n]}
                </p>
              )}

            </section>
          ))}
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="sticky-footer host-csv-sticky-footer">
          <div className="sticky-footer-inner">
            <span className="mono muted">
              {Array.from({ length: rounds }, (_, i) => i + 1).filter((n) => (counts[n] || 0) > 0).length}/{rounds} ROUNDS READY
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={Array.from({ length: rounds }, (_, i) => i + 1).some((n) => (counts[n] || 0) < 1)}
              onClick={() => {
                setStatus("waiting");
                setStage("lobby");
              }}
            >
              Continue to Host Dashboard →
            </button>
          </div>
        </div>
        </div>
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
          <p className="muted" style={{ marginTop: 8 }}>Create a fresh room or revisit the results of one of your five most recent quizzes.</p>
          {error && <div className="error-banner" style={{ marginTop: 16 }}>{error}</div>}
          <button type="button" className="btn btn-primary btn-full" style={{ marginTop: 18 }} disabled={!authenticated} onClick={() => setStage("room")}>
            {authenticated ? "Create Room" : "Verifying account..."}
          </button>
        </section>
        <section className="surface-card" style={{ marginTop: 18 }}>
          <div className="section-header">
            <div><p className="eyebrow">YOUR HISTORY</p><h2>Previous quizzes</h2></div>
            <span className="status-chip">{archives.length}/5 saved</span>
          </div>
          {archivesLoading && <p className="muted">Loading your quiz archives...</p>}
          {archivesError && <div className="error-banner">{archivesError}</div>}
          {!archivesLoading && !archivesError && archives.length === 0 && <p className="muted">Completed quizzes will appear here. Your five most recent quizzes are kept automatically.</p>}
          <div className="standings-list">
            {archives.map((archive) => {
              const expanded = expandedArchiveId === archive.id;
              const board = Array.isArray(archive.leaderboard) ? archive.leaderboard : [];
              return (
                <article key={archive.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,.08))" }}>
                  <button type="button" onClick={() => setExpandedArchiveId(expanded ? null : archive.id)} aria-expanded={expanded}
                    style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: "inherit", background: "transparent", border: 0, textAlign: "left", cursor: "pointer" }}>
                    <span><strong>{archive.room_name || "Untitled quiz"}</strong><span className="muted" style={{ display: "block", fontSize: "0.78rem", marginTop: 4 }}>{new Date(archive.completed_at).toLocaleDateString()} · {archive.rounds} rounds · {archive.participant_count} players</span></span>
                    <span className="muted">{expanded ? "−" : "+"}</span>
                  </button>
                  {expanded && <div style={{ marginTop: 12 }}>
                    {board.length ? board.map((player) => (
                      <div key={player.id} className="standing-row" style={{ padding: "7px 0" }}>
                        <span><strong>#{player.rank}</strong> {player.name}{player.eliminated ? " · Eliminated" : ""}</span>
                        <span className="standing-score">{Number(player.score || 0).toFixed(2)} pts</span>
                      </div>
                    )) : <p className="muted">No leaderboard was recorded for this quiz.</p>}
                  </div>}
                </article>
              );
            })}
          </div>
        </section>
      </main>
    );
  }

  const totalRoundSeconds = settings.roundSeconds[round] || 20;
  const progressPct = question ? Math.min(100, Math.max(0, (seconds / totalRoundSeconds) * 100)) : 0;
  const timerState = seconds <= 5 ? "urgent" : seconds <= 10 ? "warning" : "";

  /* STAGE 04: LIVE HOST CONTROL ROOM */
  return (
    <main className="host-control-screen">
      <header className="host-control-topbar">
        <a className="host-control-brand" href="/" aria-label="CloudClash home" onClick={(event) => { event.preventDefault(); requestHome(); }}>
          <img src="/assets/cloudclash/branding/logo-mark.svg" alt="" />
          <span>CLOUD<span>CLASH</span></span>
        </a>
        <div className="host-control-topbar-meta">
          <span className="host-control-live-indicator"><i /> HOST CONTROL ROOM</span>
          <span className={`host-control-status ${status}`}>{status.replace("_", " ")}</span>
        </div>
      </header>
      <div className="host-control-content">
      <header className="host-control-heading">
        <div>
          <p className="host-control-kicker">HOST CONTROL ROOM</p>
          <h1>{roomName || "Live Arena"}<span>.</span></h1>
          <p>Manage your room, monitor players and control the competition.</p>
        </div>
        <div className="host-control-round-indicator">
          <span>{status === "waiting" ? "READY TO START" : status === "finished" ? "COMPETITION ENDED" : status === "round_break" ? "ROUND BREAK" : `ROUND ${String(round).padStart(2, "0")}`}</span>
          <strong>{status === "waiting" ? "Lobby" : status === "finished" ? "Results" : status === "round_break" ? "Standings" : status === "paused" ? "Paused" : "Live"}</strong>
        </div>
      </header>

      <section className="room-banner host-room-banner">
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
        <div className="host-lobby-grid host-control-lobby-grid">
          <section className="surface-card host-control-panel host-question-overview">
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
                      {settings.roundSeconds[n] || 20}s timer · {settings.marks[n] || 5} pts/Q · {n < rounds && (settings.eliminationEnabled ? (settings.advanceCounts?.[n] ? `keep top ${settings.advanceCounts[n]}` : "everyone advances") : "elimination off")}
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

          <section className="surface-card host-control-panel host-player-lobby">
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
        <section className="arena-card host-live-panel">
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
        <section className="surface-card host-round-break-card">
          <p className="eyebrow">ROUND {String(round).padStart(2, "0")} COMPLETE</p>
          <h2>Interim Standings Locked</h2>
          <p className="muted" style={{ margin: "6px 0 18px" }}>
            {settings.eliminationEnabled
              ? "Review the current rankings below before advancing the room."
              : "Elimination is disabled. All participants will advance to the next round."}
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
          <button
            type="button"
            className="btn btn-danger btn-full"
            style={{ marginTop: 10 }}
            onClick={() => {
              if (window.confirm("End the quiz now? The current standings will be finalized and participants will move to the results screen.")) {
                action("end_quiz");
              }
            }}
          >
            End Quiz Early
          </button>
        </section>
      )}

      {status === "finished" && resultsRevealed && leaderboard.length >= 3 && <div className="confetti-overlay" aria-hidden="true">{Array.from({ length: 42 }, (_, i) => <i key={i} style={{ "--confetti-x": `${(i * 37) % 100}%`, "--confetti-delay": `${(i % 9) * -0.37}s`, "--confetti-duration": `${4 + (i % 5)}s`, "--confetti-rotation": `${i * 47}deg` }} />)}</div>}
      {status === "finished" && !resultsRevealed && (
        <section className="surface-card final-reveal-card host-final-reveal-card">
          <p className="eyebrow">QUIZ ENDED</p>
          <h2>Results are locked.</h2>
          <p className="muted">The final standings are hidden from everyone. Reveal them when you're ready to announce the winners.</p>
          <button type="button" className="btn btn-primary btn-full" onClick={() => action("reveal_final_leaderboard")}>👑 Reveal Final Leaderboard</button>
        </section>
      )}
      {(status === "round_break" || (status === "finished" && resultsRevealed)) && (
        <section className="surface-card host-leaderboard host-control-leaderboard">
          <div className="section-header host-leaderboard-heading">
            <div><p className="eyebrow">TELEMETRY STANDINGS</p><h2>{status === "finished" ? "Final Leaderboard" : "Current Leaderboard"}</h2></div>
            <div className="leaderboard-view-controls">
              <button type="button" className={leaderboardView === "overall" ? "round-tab active" : "round-tab"} onClick={() => setLeaderboardView("overall")}>Overall</button>
              <button type="button" className={leaderboardView === "round" ? "round-tab active" : "round-tab"} onClick={() => setLeaderboardView("round")}>Round-wise</button>
              {leaderboardView === "round" && <select className="input-control leaderboard-round-select" value={leaderboardRound} onChange={(e) => setLeaderboardRound(Number(e.target.value))}>{Array.from({ length: rounds }, (_, i) => <option key={i + 1} value={i + 1}>Round {i + 1}</option>)}</select>}
            </div>
          </div>
          <div className="leaderboard-column-head"><span>PLAYER</span><span>ATTEMPTED</span><span>CORRECT</span><span>WRONG</span><span>SCORE</span></div>
          <div className="host-leaderboard-list">
            {leaderboard.map((p) => {
              const stats = leaderboardView === "round" ? (p.roundStats?.[leaderboardRound] || {}) : (p.stats || {});
              const questionTotal = leaderboardView === "round" ? Number(counts[leaderboardRound] || 0) : Object.values(counts).reduce((sum, n) => sum + Number(n || 0), 0);
              const expanded = expandedPlayerId === p.id;
              const accuracy = Number(stats.accuracy || 0);
              const displayScore = leaderboardView === "round" ? Number(stats.basePoints || 0) + Number(stats.speedBonus || 0) : Number(p.score || 0);
              return (
                <article className={`host-player-card ${expanded ? "expanded" : ""} ${p.eliminated ? "is-eliminated" : ""}`} key={p.id}>
                  <button type="button" className="host-player-summary" onClick={() => setExpandedPlayerId(expanded ? null : p.id)} aria-expanded={expanded}>
                    <span className="host-player-identity"><span className="host-player-rank">#{String(p.rank).padStart(2, "0")}</span><span className="avatar-monogram">{getInitials(p.name)}</span><span className="host-player-name">{p.rank === 1 ? "👑 " : ""}{p.name}{p.left ? <small>LEFT</small> : p.eliminated ? <small>ELIMINATED</small> : null}</span></span>
                    <span className="host-player-attempted">{stats.attempted || 0}/{questionTotal}</span><span className="host-player-correct">{stats.correct || 0} ✓</span><span className="host-player-wrong">{stats.wrong || 0} ✕</span>
                    <span className="host-player-score">{displayScore.toFixed(2)} <small>pts</small><span className={`expand-chevron ${expanded ? "open" : ""}`}>⌄</span></span>
                  </button>
                  {expanded && <div className="host-player-details">
                    <div className="host-accuracy-line"><span>ACCURACY RATE: <strong>{stats.accuracy == null ? "N/A" : `${accuracy.toFixed(0)}%`}</strong></span><span>BASE: <strong>{Number(stats.basePoints || 0).toFixed(2)} pts</strong> + SPEED BONUS: <strong className="host-player-correct">+{Number(stats.speedBonus || 0).toFixed(2)} pts</strong></span></div>
                    <div className="host-accuracy-track"><span style={{ width: `${accuracy}%` }} /><i style={{ width: `${stats.attempted ? (stats.wrong / stats.attempted) * 100 : 0}%` }} /></div>
                    <div className="host-player-stat-grid">
                      <div><small>ATTEMPTED</small><strong>{stats.attempted || 0} of {questionTotal} Qs</strong></div>
                      <div><small>CORRECT / WRONG</small><strong><em>{stats.correct || 0} Correct</em> / <b>{stats.wrong || 0} Wrong</b></strong></div>
                      <div><small>AVG RESPONSE</small><strong>{stats.avgResponseMs == null ? "—" : `${(stats.avgResponseMs / 1000).toFixed(2)}s / Q`}</strong></div>
                      <div><small>BEST STREAK</small><strong className="host-streak">{stats.bestStreak || 0} in a row</strong></div>
                    </div>
                    {leaderboardView === "overall" && <div className="host-round-breakdown">{Object.entries(p.roundStats || {}).map(([roundNo, data]) => <span key={roundNo}>R{roundNo}: {data.correct || 0}/{data.attempted || 0} correct · {Number(data.speedBonus || 0).toFixed(2)} bonus</span>)}</div>}
                  </div>}
                </article>
              );
            })}
            {!leaderboard.length && <p className="muted">No participant scores yet.</p>}
          </div>
        </section>
      )}
      {status === "finished" && (
        <div className="button-group" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-secondary" onClick={requestHome}>
            ← Back to Home
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setRoomCode("");
              setRoomName("");
              setStatus("idle");
              setRounds(2);
              setActiveConfigRound(1);
              setSettings({
                roundSeconds: { 1: 15, 2: 25 },
                marks: { 1: 10, 2: 20 },
                speedBonusPercent: 10,
                eliminationEnabled: false,
                advanceCounts: { 1: 0, 2: 0 }
              });
              setParticipants([]);
              setCounts({});
              setRound(0);
              setQuestion(null);
              setSeconds(0);
              setLeaderboard([]);
              setResultsRevealed(false);
              setLeaderboardView("overall");
              setLeaderboardRound(1);
              setExpandedPlayerId(null);
              setRoundElimination(null);
              setEliminationsConfirmed(true);
              setQuestions([blankQuestion()]);
              setError("");
              setImportStatus("");
              setRoundUploads({});
              setRoundFilenames({});
              setCopied(false);
              setStage("room");
            }}
          >
            Create Another Quiz
          </button>
        </div>
      )}

      {error && <div className="error-banner host-control-error">{error}</div>}
      </div>
    </main>
  );
}