# CloudClash — Repository Guide for Coding Agents

This file is the repository-wide instruction set for AI coding agents and human contributors. Read it before changing code. More detailed subsystem notes live in `docs/`; follow those when working in the relevant area.

## 1. Product in one paragraph

CloudClash is a browser-based, real-time quiz platform for running a single live competition room. A signed-in host configures rounds, questions, timers, scoring, and optional elimination. Players join using a room code as guests or signed-in users. The Node.js server is authoritative for room state, timers, answer acceptance, scoring, standings, and host permissions. Supabase provides authentication and optional durable competition snapshots plus a private per-host archive of the five latest finished quizzes.

This is currently an event-oriented, **single-active-room** application. Do not describe or redesign it as a horizontally scaled, multi-room SaaS system unless the product requirements and architecture are deliberately changed.

## 2. Read the right context before editing

- Always read this file first.
- For broad changes, read `docs/ARCHITECTURE.md`, `docs/QUIZ-FLOW.md`, and `docs/DECISIONS.md`.
- For Socket.IO, gameplay, scoring, room ownership, or timer changes, read `docs/QUIZ-FLOW.md` and `docs/ARCHITECTURE.md`.
- For Supabase, auth, archive, SQL, or persistence changes, read `docs/DATABASE.md` and `docs/SECURITY.md`.
- For environment variables, hosting, CI, or operational changes, read `docs/DEPLOYMENT.md` and `docs/TESTING.md`.
- For React UI changes, read `client/AGENTS.md`.
- For server changes, read `server/AGENTS.md`.

If docs and code disagree, **the current implementation is the immediate source of truth**. Do not silently preserve a stale statement: verify the implementation, then update the relevant docs in the same change. Do not invent functionality from an old plan, conversation, branch name, or marketing copy.

## 3. Non-negotiable invariants

### Gameplay and server authority
1. The server is authoritative. Never trust client-provided scores, correctness, timer deadlines, current question state, host identity, elimination state, or room ownership.
2. Understand the relevant Socket.IO event handlers and their acknowledgement payloads before changing an event.
3. Preserve the existing host/participant lifecycle and reconnect/recovery behavior when making unrelated changes.
4. Only one active room is supported by the current process-wide state. Do not introduce a second room by merely adding client-side room selectors; this requires a deliberate server architecture change.
5. Do not let participants submit more than one answer for a question, submit while paused/locked/ended, or submit after elimination.
6. Keep timer behavior server-controlled. A client clock is presentation, not authority.
7. Preserve configured round limits, per-round timers and points, automatic question progression, round breaks, optional elimination, host controls, and leaderboard tie-break ordering unless a requirement explicitly changes them.
8. A finished quiz is a completed lifecycle state. A host returning to the host screen should be able to start another quiz without accidentally restoring the previous quiz as a live session. Archived results are separate from the active session.

### Authentication and data isolation
1. Hosting requires a verified Supabase account. Participants may join as guests; signed-in participants are also supported.
2. The backend must verify access tokens itself. Never trust a user ID, email, or role supplied only by the browser.
3. Host control must be checked against the authenticated account attached to the server-side Socket.IO connection and the room owner stored by the server.
4. Archive reads must be scoped to the verified account ID derived by the backend. Never accept an arbitrary host ID from the client as authorization.
5. Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code, Vite variables, client bundles, logs, documentation examples, or public responses.
6. The Supabase publishable/anon key is expected in the browser; it is not a service-role credential. Keep the service-role key server-only.
7. Keep database tables protected by RLS and do not add permissive client policies to service-role-only tables without an explicit security review.

### Archive and privacy contract
1. Keep only the five most recent completed quiz archives per host account.
2. Archive data is limited to quiz metadata and aggregated/per-participant performance results needed for the final leaderboard and reports.
3. Do **not** add question banks, question text/options, correct answers, or per-question answer history to archived records.
4. Do not create participant-facing cross-quiz history unless the product scope is explicitly changed.
5. Do not mix the active competition snapshot with completed quiz archives; they serve different purposes and have different retention/visibility rules.

### Project constraints and change hygiene
1. Keep the project web-only and free-tier-friendly unless requirements explicitly change.
2. Avoid unnecessary dependencies, paid services, background workers, or infrastructure that make the demo/event setup harder.
3. Avoid large refactors while implementing a narrow feature. Fix the requested behavior with the smallest coherent change.
4. Do not add secrets, real user data, event participant exports, or local environment files to Git.
5. Do not change deployment configuration, trigger a production deploy, merge a PR, or push directly to `main` without explicit user approval.
6. Prefer a focused feature/documentation branch and a PR for review.
7. Update documentation whenever changing architecture, security assumptions, environment variables, persistence, events, test commands, or deployment behavior.

## 4. Repository map

- `client/src/App.jsx`: top-level pathname routing, auth/session bootstrapping, landing page, global navigation.
- `client/src/Host.jsx`: host dashboard and quiz setup/control UI, including question authoring/import, archives, leaderboard and round controls.
- `client/src/Participant.jsx`: participant join/gameplay/results UI.
- `client/src/Account.jsx`: email/password sign-up and sign-in UI.
- `client/src/Profile.jsx`: player game-name and bio editor.
- `client/src/auth.js`: direct Supabase Auth REST calls, local session storage/refresh and profile metadata.
- `client/src/socket.js`: shared Socket.IO client.
- `client/src/App.css`: shared application styles.
- `server/index.js`: Express API, Socket.IO auth, single-room state machine, validation, timers, scoring, leaderboard, host commands and event broadcasts.
- `server/persistence.js`: Supabase REST persistence, competition snapshot load/save and archive read/write helpers.
- `supabase/migrations/`: competition snapshot schema.
- `server/supabase/quiz-archives.sql`: host archive table, RLS and retention RPC.
- `.github/workflows/ci.yml`: backend syntax checks and frontend production build.
- `server/load-test/`: manual Socket.IO simulator and instructions.

Do not assume that an architectural concern has a separate service/module just because it would be cleaner. The current gameplay state machine is concentrated in `server/index.js`.

## 5. Safe implementation workflow

1. Inspect the current branch and relevant files before editing.
2. Trace the full flow: UI action → Socket.IO/API request → server validation/state mutation → event/acknowledgement → UI update → persistence where relevant.
3. Identify state invariants and reconnect behavior affected by the change.
4. Implement the smallest coherent patch.
5. Add or update tests when practical. At minimum run relevant syntax/build/lint checks that are available.
6. Inspect the diff for secrets, accidental scope expansion, stale comments, and docs drift.
7. Update the relevant documentation.
8. Commit to a focused branch and report exact checks and results. Do not merge or deploy without explicit approval.

## 6. Commands

From the repository root:

```bash
# Backend dependencies and local dev server
cd server
npm install
npm run dev

# Backend syntax checks (same commands as CI)
node --check index.js
node --check persistence.js
node --check load-test/simulate.js

# Frontend
cd ../client
npm ci
npm run build
npm run lint
```

The backend defaults to memory-only mode in local development. See `docs/DEPLOYMENT.md` before configuring Supabase or production hosting. See `docs/TESTING.md` before running the load simulator.

## 7. What not to do

- Do not move authoritative scoring or timer logic into React.
- Do not expose the correct answer before the question ends through participant-facing payloads.
- Do not let host actions rely on a client-supplied account ID.
- Do not use the service-role key in `client/` or any `VITE_*` variable.
- Do not store raw questions or answer-by-answer logs in quiz archives.
- Do not assume that a passing local load test proves production hosting capacity.
- Do not turn the current single-room runtime into multi-room architecture as an incidental refactor.
- Do not remove backwards compatibility for restored snapshot versions without checking existing persisted data.
- Do not claim a feature is tested merely because a documentation file says it is.

## 8. Documentation maintenance

Documentation is part of the change, not optional polish. When you change:
- Socket event names or payloads → update `docs/QUIZ-FLOW.md`.
- Database schema, RLS, archive fields or retention → update `docs/DATABASE.md` and `docs/SECURITY.md`.
- Environment variables or hosting → update `docs/DEPLOYMENT.md`.
- Commands, CI, or load-test behavior → update `docs/TESTING.md`.
- Product behavior and implemented feature scope → update `docs/FEATURES.md`.
- A durable technical trade-off → update `docs/DECISIONS.md`.

Keep statements precise. Mark planned or unverified behavior as such.
