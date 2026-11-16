# Testing and Validation

## 1. Automated checks currently in CI

Workflow: `.github/workflows/ci.yml`.

The CI job currently:
- checks backend JavaScript syntax using `node --check` on `server/index.js`, `server/persistence.js`, and `server/load-test/simulate.js`;
- runs `npm ci` in `client/`;
- runs `npm run build` in `client/`.

CI does not currently run:
- ESLint;
- a unit-test suite;
- automated browser end-to-end tests;
- the load simulator;
- a live Supabase integration test.

Do not claim those checks ran unless the workflow is changed and the run confirms it.

## 2. Useful local checks

Backend syntax:
```bash
cd server
node --check index.js
node --check persistence.js
node --check load-test/simulate.js
```

Frontend:
```bash
cd client
npm ci
npm run build
npm run lint
```

The frontend package defines `lint`, but the current CI workflow does not invoke it. Record lint results separately from CI results.

## 3. Load simulator

Files:
- `server/load-test/simulate.js`
- `server/load-test/README.md`

The simulator is a manual Socket.IO test tool. It connects virtual clients to a backend, joins them to a room already created through the host dashboard, waits for the host to start the quiz, sends answer attempts, observes round/elimination events, and prints a latency/result summary on Ctrl+C.

It is **not** a zero-configuration test and should not be assumed safe to run against an arbitrary live event. It creates real connections and interacts with the selected room.

### Safety rules
- Prefer a dedicated local/staging service.
- Read the load-test README before running it.
- The script currently rejects localhost URLs and asks for a real backend URL and room code; follow the script's current prompts.
- Do not run against a production event without explicit authorization and a planned test window.
- Do not assume synthetic participants are removed automatically; inspect current room cleanup behavior before testing.

### Important source/document mismatch to watch

The root README describes a local two-round synthetic load test, but the current `server/load-test/README.md` and simulator describe a manual deployed-room simulator. The simulator source is the operational truth. If changing the tool, update both guides to match the actual script. This documentation set intentionally avoids calling it an automated CI test.

## 4. Manual regression matrix

For changes that touch gameplay, run the relevant subset:

| Area | Verify |
|---|---|
| Authentication | Sign up/sign in, refresh, invalid/expired session, sign out |
| Host authorization | Unauthenticated host rejected; another account cannot take over active room |
| Guest joining | Guest can join with room code without account |
| Signed-in joining | Saved game name prefill and participant join |
| Question authoring | Manual create/edit/duplicate/delete/reorder; CSV validation |
| Timer | Start, countdown, pause, resume, timeout, manual end |
| Answers | Correct/wrong/unanswered, duplicate submission rejection, locked/paused rejection |
| Rounds | Round break, standings, next round, completion |
| Elimination | No elimination, configured keep count, tie at cutoff, confirmed eliminated answer rejection |
| Leaderboard | Score ordering, correct-count tie-break, response-time tie-break |
| Recovery | Host reconnect in waiting/running/paused/round break/finished |
| Persistence | Snapshot write/restore and health endpoint |
| Archives | Successful save, failure message, host isolation, maximum five, newest-first order |
| Navigation | Return home, start another quiz, browser back during active session |

## 5. Testing principles

- Use synthetic participants and disposable rooms.
- Validate server outcomes, not just UI appearance.
- Test both accepted and rejected paths.
- For timers, test boundary races and ensure only one transition occurs.
- For persistence, test a fresh state and a restored state.
- For archive changes, inspect the actual JSON payload and ensure it does not contain questions or answer-by-answer records.
- A local test is not proof of production performance; repeat a controlled staging rehearsal when the deployment environment matters.
