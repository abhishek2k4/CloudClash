
import { useEffect, useState } from "react";
import { socket } from "./socket";
import "./App.css";

function Participant() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [competitionStarted, setCompetitionStarted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handleParticipants = (data) => {
      setParticipants(data);
    };

    const handleCompetitionStarted = () => {
      setCompetitionStarted(true);
    };

    socket.on("participants_updated", handleParticipants);
    socket.on("competition_started", handleCompetitionStarted);

    socket.connect();

    return () => {
      socket.off("participants_updated", handleParticipants);
      socket.off("competition_started", handleCompetitionStarted);
      socket.disconnect();
    };
  }, []);

  const joinCompetition = () => {
    setError("");

    socket.emit(
      "join_competition",
      { name, code },
      (response) => {
        if (response.success) {
          setJoined(true);
          setParticipants((current) => {
            if (current.some((p) => p.id === response.participant.id)) {
              return current;
            }
            return [...current, response.participant];
          });
        } else {
          setError(response.message);
        }
      }
    );
  };

  if (competitionStarted) {
    return (
      <main className="container">
        <h1>CLOUD CLASH</h1>
        <h2>Competition Started!</h2>
        <p>Get ready. Your first question is coming soon.</p>
      </main>
    );
  }

  if (joined) {
    return (
      <main className="container">
        <h1>CLOUD CLASH</h1>
        <h2>You're in, {name}!</h2>
        <p>Waiting for the host to start the competition.</p>

        <h3>Participants joined: {participants.length}</h3>

        <ul>
          {participants.map((person) => (
            <li key={person.id}>{person.name}</li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <main className="container">
      <h1>CLOUD CLASH</h1>
      <p>Ready to challenge your knowledge?</p>

      <input
        placeholder="Enter your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <input
        placeholder="Competition code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />

      <button onClick={joinCompetition}>Join Competition</button>

      {error && <p className="error">{error}</p>}
    </main>
  );
}

export default Participant;
