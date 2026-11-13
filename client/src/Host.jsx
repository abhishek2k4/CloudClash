import { useEffect, useState } from "react";
import { socket } from "./socket";
import "./App.css";

function Host() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [status, setStatus] = useState("waiting");
  const [round, setRound] = useState(0);
  const [question, setQuestion] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const onConnect = () => { setConnected(true); setError(""); };
    const onDisconnect = () => { setConnected(false); setError("Disconnected. Reconnecting..."); };
    const onParticipants = setParticipants;
    const onStatus = setStatus;
    const onQuestion = (data) => { setQuestion(data); setRound(data.round); setSecondsLeft(Math.max(0, Math.ceil((data.endsAt - Date.now()) / 1000))); };
    const onQuestionEnded = () => setQuestion(null);
    const onRoundStarted = ({ round: next }) => { setRound(next); setStatus("running"); setQuestion(null); };
    const onRoundFinished = ({ leaderboard: data }) => { setLeaderboard(data); setStatus("round_break"); setQuestion(null); };
    const onFinished = ({ leaderboard: data }) => { setLeaderboard(data); setStatus("finished"); setQuestion(null); };
    socket.on("connect", onConnect); socket.on("disconnect", onDisconnect);
    socket.on("participants_updated", onParticipants); socket.on("competition_status_updated", onStatus);
    socket.on("question_started", onQuestion); socket.on("question_ended", onQuestionEnded);
    socket.on("round_started", onRoundStarted); socket.on("round_finished", onRoundFinished);
    socket.on("competition_finished", onFinished); socket.connect();
    return () => {
      socket.off("connect", onConnect); socket.off("disconnect", onDisconnect);
      socket.off("participants_updated", onParticipants); socket.off("competition_status_updated", onStatus);
      socket.off("question_started", onQuestion); socket.off("question_ended", onQuestionEnded);
      socket.off("round_started", onRoundStarted); socket.off("round_finished", onRoundFinished);
      socket.off("competition_finished", onFinished); socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!question) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((question.endsAt - Date.now()) / 1000)));
    tick(); const timer = setInterval(tick, 200); return () => clearInterval(timer);
  }, [question]);

  const login = () => socket.emit("host_login", password, (response) => {
    if (!response.success) return setError(response.message);
    setAuthenticated(true); setParticipants(response.participants); setStatus(response.status);
    setRound(response.round || 0); setLeaderboard(response.leaderboard || []);
    if (response.question) setQuestion(response.question);
  });
  const action = (event) => socket.emit(event, (response) => { if (!response.success) setError(response.message); });

  if (!authenticated) return <main className="container panel">
    <p className="eyebrow">CONTROL ROOM</p><h1>CLOUD CLASH</h1><h2>Host login</h2>
    <p className="muted">Server: {connected ? "Connected" : "Connecting..."}</p>
    <input type="password" placeholder="Host password" value={password} onChange={(e) => setPassword(e.target.value)} />
    <button onClick={login} disabled={!connected || !password}>Login</button>
    {error && <p className="error">{error}</p>}
  </main>;

  return <main className="container wide">
    <header className="topbar"><div><p className="eyebrow">CONTROL ROOM</p><h1>CLOUD CLASH</h1></div><span className="live-pill">{status.toUpperCase().replace("_", " ")}</span></header>
    <div className="stats-grid"><section className="panel"><p className="muted">Participants</p><h2>{participants.length}</h2></section><section className="panel"><p className="muted">Current round</p><h2>{round || "—"}</h2></section></div>
    {status === "waiting" && <section className="panel"><h2>Lobby ready</h2><p>{participants.length} participants have joined.</p><button disabled={!participants.length} onClick={() => action("start_competition")}>Start Round 1</button></section>}
    {status === "running" && <section className="panel"><div className="question-meta"><span>ROUND {round} · QUESTION {question?.questionNumber || "—"}/{question?.totalQuestions || "—"}</span><strong>{secondsLeft}s</strong></div><h2>{question?.text || "Preparing next question..."}</h2><div className="option-grid">{question?.options.map((option, i) => <div className="option host-option" key={option}>{String.fromCharCode(65+i)}. {option}</div>)}</div><p className="muted">Questions advance automatically when the timer expires.</p></section>}
    {status === "round_break" && <section className="panel"><h2>Round 1 complete</h2><p>Review the standings, then start Round 2 when ready.</p><button onClick={() => action("start_round_two")}>Start Round 2</button></section>}
    {(status === "round_break" || status === "finished") && <section className="panel"><h2>{status === "finished" ? "Final leaderboard" : "Round 1 leaderboard"}</h2>{leaderboard.map((p) => <div className="leader-row" key={p.id}><strong>#{p.rank} {p.name}</strong><span>{p.score} pts</span></div>)}</section>}
    {status === "finished" && <section className="panel"><h2>Competition finished</h2><p>Final scores are displayed above.</p></section>}
    <section className="panel"><h2>Participants ({participants.length})</h2>{participants.map((p) => <div className="leader-row" key={p.id}><span>{p.name}</span><span className="muted">Joined</span></div>)}</section>
    {error && <p className="error">{error}</p>}
  </main>;
}
export default Host;
