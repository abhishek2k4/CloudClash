
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

// Competition configuration
const COMPETITION_CODE = "CLOUD26";
const HOST_PASSWORD = "admin123";

// Temporary in-memory data
const participants = new Map();
let competitionStatus = "waiting";

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "CLOUD CLASH server is running",
  });
});

// Socket.IO events
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // PARTICIPANT JOIN
  socket.on("join_competition", ({ name, code }, callback) => {
    if (competitionStatus !== "waiting") {
      return callback({
        success: false,
        message: "Competition has already started",
      });
    }

    if (code !== COMPETITION_CODE) {
      return callback({
        success: false,
        message: "Invalid competition code",
      });
    }

    if (!name?.trim()) {
      return callback({
        success: false,
        message: "Enter your name",
      });
    }

    const participant = {
      id: socket.id,
      name: name.trim(),
      joinedAt: Date.now(),
    };

    participants.set(socket.id, participant);
    socket.join("competition");

    callback({
      success: true,
      participant,
    });

    // Update participants for everyone
    const updatedParticipants = Array.from(participants.values());

    io.to("competition").emit(
      "participants_updated",
      updatedParticipants
    );

    io.to("host").emit(
      "participants_updated",
      updatedParticipants
    );

    console.log(`${participant.name} joined`);
  });

  // HOST LOGIN
  socket.on("host_login", (password, callback) => {
    if (password !== HOST_PASSWORD) {
      return callback({
        success: false,
        message: "Incorrect host password",
      });
    }

    socket.join("host");

    callback({
      success: true,
      participants: Array.from(participants.values()),
      status: competitionStatus,
    });

    console.log("Host logged in:", socket.id);
  });

  // START COMPETITION
  socket.on("start_competition", (callback) => {
    if (!socket.rooms.has("host")) {
      return callback({
        success: false,
        message: "Unauthorized",
      });
    }

    if (competitionStatus !== "waiting") {
      return callback({
        success: false,
        message: "Competition already started",
      });
    }

    competitionStatus = "running";

    io.to("competition").emit("competition_started");

    io.to("host").emit(
      "competition_status_updated",
      competitionStatus
    );

    callback({
      success: true,
    });

    console.log("Competition started!");
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    if (participants.delete(socket.id)) {
      const updatedParticipants = Array.from(participants.values());

      io.to("competition").emit(
        "participants_updated",
        updatedParticipants
      );

      io.to("host").emit(
        "participants_updated",
        updatedParticipants
      );
    }

    console.log("Disconnected:", socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`CLOUD CLASH running on port ${PORT}`);
});
