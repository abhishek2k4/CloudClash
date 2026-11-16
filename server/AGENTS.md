# Backend Agent Instructions

Read the repository root `AGENTS.md` first. This file describes constraints for the Node.js/Express/Socket.IO backend.

## Current structure

- `index.js` contains Express routes, Supabase token verification, Socket.IO middleware, the single active competition state, gameplay state machine, validation, timers, scoring, leaderboard generation, and event handlers.
- `persistence.js` contains Supabase REST helpers for the active competition snapshot and host quiz archives.
- `supabase/quiz-archives.sql` creates the host archive table and the archive/retention RPC.
- `../supabase/migrations/` contains the active competition snapshot schema.

Do not assume the server is stateless or that its in-memory maps can be shared between instances. They are process-local.

## State ownership

The backend owns the authoritative values for:
- room code/name and authenticated room owner;
- configured rounds and per-round settings;
- question banks and active question index;
- participant identity/connection state;
- accepted answers and answer timing;
- round/total stats and eliminated participant IDs;
- quiz status, question lock, deadlines and remaining time;
- leaderboard order and final reports.

When changing these values, inspect snapshot serialization/restoration as well as live event behavior. Do not update only the in-memory path while leaving restored sessions inconsistent.

## Authorization

- Express archive reads pass through `requireAccount`, which verifies the bearer access token with Supabase Auth and obtains the account ID from the verified response.
- Socket.IO middleware verifies an optional access token. A no-token connection remains possible for guest participants.
- Hosting actions must require `socket.data.userId` and server-side room ownership checks.
- Never trust a participant ID or account ID supplied by the browser as proof of identity. Check how the existing handler binds a socket to its participant record before changing it.
- Keep host room ownership stable over reconnects and prevent a different account from taking over an active room.

## Timers and answer processing

- Server deadlines and lock state control answer acceptance.
- Answers are serialized through the answer queue; retain ordering guarantees when changing answer handlers.
- Before changing a timer, inspect question start, pause, resume, timeout, manual end, round transition, finish, and restore code.
- Avoid races between the timeout callback and the answer queue.
- Do not trust client-reported elapsed time for scoring unless it is checked against server-owned timing.

## Persistence

There are two separate persistence concepts:
1. **Active competition snapshot**: one JSON state row keyed by `COMPETITION_CODE` in `competition_state`, storing current room/game state so the same backend can restore it.
2. **Completed quiz archive**: rows in `quiz_archives`, scoped by `host_user_id`, with final metadata and leaderboard analytics, capped at five per host by the database function.

Do not confuse or merge these storage paths. Check `persistenceEnabled` and `hasCredentials` separately: the active snapshot requires persistence to be enabled; archive helpers require Supabase credentials.

## Operational assumptions

- One backend process/instance is the supported deployment model.
- In-memory maps, timers and queues are not distributed across processes.
- A restart in memory-only mode loses active room state.
- A Supabase-backed snapshot can restore active competition state after restart, subject to the implementation's snapshot/timer recovery behavior.
- Never add serverless or multi-instance deployment assumptions without introducing a shared coordination/state design.

## Validation

From `server/`:
```bash
node --check index.js
node --check persistence.js
node --check load-test/simulate.js
```

The load test is a manual simulator, not a complete automated unit/integration test suite. See `docs/TESTING.md` before using it. Any change to scoring, auth, room ownership, timers, archive logic or snapshot compatibility deserves a focused manual test.
