# CLOUD CLASH load test

This script drives the real Socket.IO server with virtual participants and a synthetic 50-question bank. It runs both rounds and checks that every participant receives 50 question events, all 2,500 (for 50 participants) answers are accepted, and final scores are correct.

## Install

From the `server` directory:

```powershell
npm install
```

This installs the `socket.io-client` development dependency and refreshes `package-lock.json` if needed.

## Prepare a clean local test

1. Stop the backend.
2. Keep `PERSISTENCE_ENABLED=false` in `server/.env`.
3. Temporarily set short timers in `server/.env`:

```env
ROUND_1_SECONDS=2
ROUND_2_SECONDS=2
```

4. Restart the backend and make sure `http://localhost:5000/health` reports `competition: waiting`.
5. Do not use the host dashboard or participant browser during the automated run; the script controls the test competition.

## Run

In a second terminal, from `server`:

```powershell
npm run test:load
```

Optional settings:

```powershell
$env:LOAD_TEST_PARTICIPANTS=50
$env:LOAD_TEST_URL="http://localhost:5000"
npm run test:load
```

The script uses `COMPETITION_CODE` and `HOST_PASSWORD` from `server/.env`. It imports synthetic questions into the fresh local competition, joins the requested number of virtual participants, answers every question, starts Round 2 automatically after the Round 1 break, and checks the final leaderboard.

## Important

- Run only against a dedicated local or staging competition. The script imports questions and starts the event.
- Local memory-only mode is recommended. Do not point this at the live event or a production database.
- The default participant count is 50; maximum supported by this script is 100.
- The test measures application-level acknowledgement latency, not browser rendering latency.
- A passing local test is not proof that a free hosting instance will perform identically. Repeat against staging before the event.
- Restore your normal round timer values after testing.
