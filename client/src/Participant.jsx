import { useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import "./App.css";

function Participant() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const participantRef = useRef(null);
  const [participant, setParticipant] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [question, setQuestion] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [status, setStatus] = useState("waiting");
  const [error, setError] = useState("");

  useEffect(() => {
    const onParticipants = (data) => setParticipants(data);
    const onQuestion = (data) => {
      setQuestion(data); setSelected(null); setSubmitted(false); setResult(null);
      setSecondsLeft(Math.max(0, Math.ceil((data.endsAt - Date.now()) / 1000)));
      setStatus("running");
    };
    const onQuestionEnded = (data) => {
      setResult(data); setQuestion(null);
    };
    const onRoundStarted = ({ round }) => { setStatus("running"); setResult({ message: `Round ${round} is starting...` }); };
    const onRoundFinished = ({ round, leaderboard: data }) => {
      setStatus("round_break"); setQuestion(null); setLeaderboard(data);
      setResult({ message: `Round ${round} complete` });
    };
    const onFinished = ({ leaderboard: data }) => { setStatus("finished"); setLeaderboard(data); setQuestion(null); };
    socket.on("participants_updated", onParticipants);
    socket.on("question_started", onQuestion);
    socket.on("question_ended", onQuestionEnded);
    socket.on("round_started", onRoundStarted);
    socket.on("round_finished", onRoundFinished);
    socket.on("competition_finished", onFinished);
    const applyParticipantSnapshot = (response, joinedCode) => {
      if (!response.success) {
        participantRef.current = null;
        setParticipant(null);
        setError(response.message);
        return;
      }
      const joined = { ...response.participant, code: joinedCode };
      participantRef.current = joined;
      setParticipant(joined);
      setParticipants(response.snapshot?.participants || []);
      setStatus(response.snapshot?.status || "waiting");
      setLeaderboard(response.snapshot?.leaderboard || []);
      setQuestion(response.snapshot?.question || null);
      setSelected(response.snapshot?.answer?.selectedOption ?? null);
      setSubmitted(Boolean(response.snapshot?.answer));
      setResult(null);
      setSecondsLeft(response.snapshot?.question?.endsAt ? Math.max(0, Math.ceil((response.snapshot.question.endsAt - Date.now()) / 1000)) : 0);
    };
    const onConnect = () => {
      const current = participantRef.current;
      if (!current?.id || !current?.code || !current?.name) return;
      socket.emit("join_competition", {
        name: current.name, code: current.code, participantId: current.id,
      }, (response) => applyParticipantSnapshot(response, current.code));
    };
    socket.on("connect", onConnect);
    socket.on("connect_error", () => setError("Connection lost. Trying to reconnect..."));
    socket.connect();
    return () => {
      socket.off("connect", onConnect);
      socket.off("participants_updated", onParticipants);
      socket.off("question_started", onQuestion);
      socket.off("question_ended", onQuestionEnded);
      socket.off("round_started", onRoundStarted);
      socket.off("round_finished", onRoundFinished);
      socket.off("competition_finished", onFinished);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!question) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((question.endsAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [question]);

  const join = () => {
    setError("");
    socket.emit("join_competition", { name, code, participantId: participantRef.current?.id }, (response) => {
      if (!response.success) return setError(response.message);
      const joined = { ...response.participant, name, code };
      setParticipant(joined);
      participantRef.current = joined;
      setParticipants(response.snapshot?.participants || []);
      const snapshot = response.snapshot;
      if (snapshot?.question) {
        setQuestion(snapshot.question);
        setSelected(snapshot.answer?.selectedOption ?? null);
        setSubmitted(Boolean(snapshot.answer));
        setStatus("running");
      } else {
        setQuestion(null);
        setSelected(null);
        setSubmitted(false);
        setResult(null);
        setStatus(snapshot?.status || "waiting");
        setLeaderboard(snapshot?.leaderboard || []);
      }
    });
  };

  const submit = () => {
    if (selected === null || submitted || !question || !participant) return;
    socket.emit("submit_answer", {
      participantId: participant.id,
      questionNumber: question.questionNumber,
      selectedOption: selected,
    }, (response) => {
      if (!response.success) setError(response.message);
      else setSubmitted(true);
    });
  };

  const renderLeaderboard = () => (
    <section className="panel">
      <h2>Leaderboard</h2>
      {leaderboard.map((entry) => <div className="leader-row" key={entry.id}>
        <strong>#{entry.rank} {entry.name}</strong><span>{entry.score} pts</span>
      </div>)}
    </section>
  );

  if (!participant) return <main className="container panel">
    <p className="eyebrow">LIVE QUIZ EVENT</p><h1>CLOUD CLASH</h1>
    <p>Join the competition</p>
    <input placeholder="Your display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
    <input placeholder="Competition code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
    <button onClick={join} disabled={!name.trim() || !code.trim()}>Join competition</button>
    {error && <p className="error">{error}</p>}
  </main>;

  return <main className="container wide">
    <header className="topbar"><div><p className="eyebrow">CLOUD CLASH</p><h1>Hey, {participant.name}</h1></div><span className="live-pill">{status === "running" ? "LIVE" : status.replace("_", " ").toUpperCase()}</span></header>
    {question && <section className="panel">
      <div className="question-meta"><span>ROUND {question.round} · QUESTION {question.questionNumber}/{question.totalQuestions}</span><strong className={secondsLeft <= 5 ? "urgent" : ""}>{secondsLeft}s</strong></div>
      <h2 className="question-text">{question.text}</h2>
      <div className="option-grid">{question.options.map((option, index) => <button key={option} className={selected === index ? "option selected" : "option"} disabled={submitted || secondsLeft === 0} onClick={() => setSelected(index)}>{String.fromCharCode(65 + index)}. {option}</button>)}</div>
      <button className="submit-button" disabled={selected === null || submitted || secondsLeft === 0} onClick={submit}>{submitted ? "Answer submitted" : "Submit answer"}</button>
      {submitted && <p className="muted">Locked in. Wait for the next question.</p>}
    </section>}
    {!question && status === "waiting" && <section className="panel"><h2>You're in.</h2><p>Waiting for the host to start Round 1.</p><p className="muted">{participants.length} participants joined</p></section>}
    {!question && status === "running" && <section className="panel"><h2>Answer locked</h2><p>Question closed. Get ready for the next one.</p></section>}
    {!question && status === "round_break" && <section className="panel"><h2>Round complete</h2><p>Take a breath. The host will start the next round.</p></section>}
    {!question && status === "finished" && <section className="panel"><h2>Competition finished!</h2><p>That's a wrap. Here's the final result.</p></section>}
    {result?.correctOption !== undefined && <p className="feedback">Correct answer: {String.fromCharCode(65 + result.correctOption)}{result.explanation ? ` — ${result.explanation}` : ""}</p>}
    {error && <p className="error">{error}</p>}
    {(status === "round_break" || status === "finished") && renderLeaderboard()}
  </main>;
}
export default Participant;
