# CLOUD CLASH

A two-round, real-time quiz platform for a single hosted event.

## Stack

- React + Vite participant and host interfaces
- Node.js + Express + Socket.IO authoritative quiz server
- Supabase Postgres for competition-state snapshots
- Render (server) and Vercel (client) are the intended deployment targets

## Local setup

Requirements: Node.js 20.19+ (or 22.12+), npm, and a Supabase project.

### 1. Database

In the Supabase SQL Editor, run:

```sql
create table if not exists public.competition_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.competition_state enable row level security;
```

Use the project's server-side Secret key in the backend environment only. Never put it in a Vite variable or commit it.

### 2. Backend

```powershell
cd server
npm install
```

Create `server/.env` from `server/.env.example` and set:
- `HOST_PASSWORD`: a strong private host password
- `COMPETITION_CODE`: the code participants enter
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: your Supabase project URL and Secret key
- `CLIENT_ORIGIN`: the exact frontend origin; multiple origins can be comma-separated

Then run:

```powershell
npm run dev
```

Backend health endpoint: `http://localhost:5000/health`.

### 3. Frontend

In a second terminal:

```powershell
cd client
npm install
```

Create `client/.env` from `client/.env.example`. Set `VITE_SERVER_URL=http://localhost:5000`, then:

```powershell
npm run dev
```

Open the Vite URL for participants and append `/host` for the host dashboard.

## Competition rules

- 25 questions per round; 50 total
- Round 1: 5 points per correct answer; Round 2: 10 points
- No negative marking; incorrect or unanswered questions score zero
- Timers are server-controlled and configured with `ROUND_1_SECONDS` and `ROUND_2_SECONDS`
- Questions advance automatically; the host starts Round 2 after reviewing Round 1
- One attempt per participant per question
- Tie-break order: total score, number of correct answers, lower total response time, then name

## Question import

From the host dashboard (`/host`), download the CSV template, fill all 50 rows in Excel or Google Sheets, and upload it before starting Round 1.

Required columns: `round,question,option_a,option_b,option_c,option_d,correct_option,explanation`.

Use round `1` or `2`; correct option can be `A`, `B`, `C`, or `D`. Explanation is optional. Export as CSV UTF-8. The importer validates the full file before replacing the question bank.

## Persistence and recovery

The backend stores the competition as a JSON snapshot in Supabase. It restores participants, imported questions, scores, accepted answers, round status, and the active question deadline on startup. A participant reconnecting during a live question receives their own submitted-answer state, so they cannot accidentally submit twice after refreshing.

The server health endpoint reports `503 degraded` when configured persistence cannot be restored or a save has failed. In memory-only mode, health is available but explicitly reports that persistence is not enabled; do not use that mode for the live event.

**Operational limitation:** this is a single-server, single-event design. Do not run multiple backend instances against the same competition row. A database outage can prevent answer acceptance. Take a controlled test run before the event and verify Supabase connectivity, host access, question import, reconnects, and a full two-round finish.

## Deployment checklist

### Backend (Render)
- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Set `PORT` via the platform (do not hardcode it)
- Set `CLIENT_ORIGIN` to the deployed Vercel URL
- Add `COMPETITION_CODE`, `HOST_PASSWORD`, both round timer values, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`
- Use one instance; enable WebSocket support (Render supports Socket.IO over WebSockets)

### Frontend (Vercel)
- Root directory: `client`
- Build command: `npm run build`
- Output directory: `dist`
- Set `VITE_SERVER_URL` to the deployed backend URL (no trailing slash)

### Before opening the event
1. Import and verify the actual 50 questions.
2. Test with at least 30 simulated or real participant browsers.
3. Test one correct answer, one wrong answer, an unanswered timeout, and duplicate submission.
4. Restart the backend during a test question and verify the remaining deadline and participant answer state.
5. Verify Round 1 leaderboard, manual Round 2 start, and final leaderboard.
6. Keep the host laptop and network stable; do not restart or redeploy during the live event.

## Demo content

The included questions in `server/data/questions.js` are placeholders for local development only. Replace them by importing the approved event CSV before the competition.
