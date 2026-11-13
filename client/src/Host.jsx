
import { useEffect, useState } from "react";
import { socket } from "./socket";

function Host() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [status, setStatus] = useState("waiting");
  const [error, setError] = useState("");

  // Connect host to Socket.IO server
  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      setError("");
    };

    const handleDisconnect = () => {
      setConnected(false);
      setError("Disconnected from server. Reconnecting...");
    };

    const handleParticipants = (data) => {
      setParticipants(data);
    };

    const handleStatus = (data) => {
      setStatus(data);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", () => {
      setError("Unable to connect to server.");
    });

    socket.on("participants_updated", handleParticipants);
    socket.on("competition_status_updated", handleStatus);

    socket.connect();

    if (socket.connected) {
      setConnected(true);
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("participants_updated", handleParticipants);
      socket.off("competition_status_updated", handleStatus);
      socket.disconnect();
    };
  }, []);

  const login = () => {
    if (!socket.connected) {
      setError("Server connection not ready. Please wait.");
      return;
    }

    setError("");

    socket.emit("host_login", password, (response) => {
      if (!response.success) {
        setError(response.message);
        return;
      }

      setAuthenticated(true);
      setParticipants(response.participants);
      setStatus(response.status);
    });
  };

  const startCompetition = () => {
    socket.emit("start_competition", (response) => {
      if (!response.success) {
        setError(response.message);
      }
    });
  };

  if (!authenticated) {
    return (
      <main className="container">
        <h1>CLOUD CLASH</h1>
        <h2>Host Login</h2>

        <p>
          Server: {connected ? "Connected" : "Connecting..."}
        </p>

        <input
          type="password"
          placeholder="Host password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button
          onClick={login}
          disabled={!connected}
        >
          Login
        </button>

        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  return (
    <main className="container">
      <h1>CLOUD CLASH — Host Dashboard</h1>

      <h2>Participants: {participants.length}</h2>

      <p>Status: {status.toUpperCase()}</p>

      <ul>
        {participants.map((person) => (
          <li key={person.id}>{person.name}</li>
        ))}
      </ul>

      {status === "waiting" && (
        <button onClick={startCompetition}>
          Start Competition
        </button>
      )}

      {status === "running" && (
        <h2>Competition is live!</h2>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}

export default Host;
