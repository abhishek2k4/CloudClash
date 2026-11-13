# CLOUD CLASH

A two-round, real-time quiz platform for a single hosted event.

## Local setup

### Server
```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Set a private `HOST_PASSWORD` in `server/.env`. Never commit the real `.env` file.

### Client
```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Open the Vite URL for participants and append `/host` for the host dashboard.

## Quiz configuration

Edit `server/data/questions.js`. Each round is an array of question objects:

- `text`: question text
- `options`: array of answer strings
- `correctOption`: zero-based index of the correct option
- `explanation`: optional explanation shown after the question

The included questions are **demo content only**. Replace them with the approved event questions. The final event configuration should contain 25 questions in each round.

Round marks are fixed at 5 for Round 1 and 10 for Round 2. Configure per-question timers with `ROUND_1_SECONDS` and `ROUND_2_SECONDS`.

## Current engine scope

- Server-owned question deadlines and answer validation
- Automatic question progression
- One accepted answer per participant per question
- Server-side scoring; correct answers are not sent before the question ends
- Round 1 results, host-controlled start of Round 2, and final results
- Participant records survive temporary socket disconnects while the server process remains alive

**Important:** this first engine version stores event state in memory. A server restart clears participants and scores. Use a persistent database before relying on this for the live event.
