# CLOUD CLASH

A real-time quiz platform for a single live room, with host-configurable rounds and server-authoritative gameplay.

## Stack

- React + Vite
- Node.js + Express + Socket.IO
- Supabase Postgres for optional persisted competition snapshots
- Render (backend) and Vercel (frontend) deployment targets

## Local setup

Requirements: Node.js 20.19+ (or 22.12+), npm.

### Backend

```powershell
cd server
npm install
```

Create `server/.env` from `server/.env.example` and set:
- `HOST_PASSWORD`: private host password
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: server-side Supabase credentials when persistence is required
- `CLIENT_ORIGIN`: frontend origin

Local development is memory-only by default. Set `PERSISTENCE_ENABLED=true` only when intentionally testing persisted state. Production enables persistence by default when credentials exist.

Run `npm run dev`. Backend health: `http://localhost:5000/health`.

### Frontend

```powershell
cd client
npm install
```

Create `client/.env` from `client/.env.example` and set `VITE_SERVER_URL=http://localhost:5000`. Run `npm run dev`.

Open the frontend root URL. The landing page provides **Create quiz** and **Join quiz**.

## User flow

1. Host chooses **Create quiz** and authenticates with the host password.
2. Host chooses 1–10 rounds and sets points per correct answer (1–100) and question timer (5–300 seconds) for each round.
3. The server creates a room and returns a generated room code.
4. Host imports a CSV question bank and shares the room code.
5. Players join from the landing page using a display name and room code.
6. Host starts the quiz. Questions advance automatically when their server timer expires.
7. Host can pause and resume the active question. Pause freezes the remaining time and blocks answer submissions; resume continues the same question with the remaining time.
8. At each round break, the host starts the next round. The final round ends the quiz and shows the leaderboard.

Only one active room is supported at a time. A host can create a new room after the previous quiz has finished.

## Question import

Download the CSV template from the host dashboard. Required columns:

`round,question,option_a,option_b,option_c,option_d,correct_option`

Optional column: `explanation`.

Use round numbers from 1 through the number configured during quiz creation. Correct option accepts A, B, C or D (also 1–4). Every configured round must contain at least one question before the host can start. Importing replaces the full question bank.

## Scoring and controls

- Correct answers earn the points configured for that round.
- Incorrect and unanswered questions score zero; no negative marking.
- One answer per player per question.
- Leaderboard tie-break order: total score, correct answers, lower total response time, then name.
- Start, pause, resume and end actions are validated by the server.
- The server owns question deadlines; clients cannot extend the timer or submit while paused/closed.

## Persistence and operational notes

The backend stores a JSON snapshot in Supabase when persistence is enabled. Use one backend instance only; this is a single-room event application, not a horizontally scaled multi-room service. During a live event, confirm Supabase health and run a complete rehearsal.

Local memory-only mode resets the room when the backend restarts. Production persistence restores the saved room and active timer state. Treat the host password and Supabase Secret key as server-only secrets.

## Load test

With the backend running locally and `HOST_PASSWORD` set in `server/.env`:

```powershell
cd server
npm run test:load
```

The simulator creates a fresh two-round room, imports synthetic questions, joins up to 50 virtual players, plays both rounds, and checks accepted answers and final scoring. It uses 5-second questions to keep the run manageable. Run it against a fresh local backend; it is not a production test.

## Deployment

### Backend (Render)
- Root directory: `server`
- Build: `npm install`
- Start: `npm start`
- Configure `HOST_PASSWORD`, `CLIENT_ORIGIN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `NODE_ENV=production`
- Keep a single backend instance

### Frontend (Vercel)
- Root directory: `client`
- Build: `npm run build`
- Output: `dist`
- Set `VITE_SERVER_URL` to the deployed backend URL

Before the event, rehearse player joining, question import, start/pause/resume, each round transition, ending the quiz, reconnects, and final leaderboard.
