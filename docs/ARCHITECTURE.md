# CloudClash Architecture

## 1. System overview

CloudClash is a browser client connected to one Node.js application server. The browser handles presentation and user interaction; the server owns the live competition. Supabase is used for identity and durable storage.

```text
Browser (React + Vite)
  ├─ Landing / route selection (app/App.jsx)
  ├─ Account + profile UI
  ├─ Host dashboard
  └─ Participant gameplay
       │
       ├─ Supabase Auth REST API (email/password, refresh, profile metadata)
       │
       └─ Socket.IO connection ───────────────┐
                                               ▼
                                      Node.js server
                                      Express + Socket.IO
                                      ├─ Auth token verification
                                      ├─ Host authorization
                                      ├─ Single-room state machine
                                      ├─ Question/timer engine
                                      ├─ Answer validation/scoring
                                      ├─ Leaderboard/report generation
                                      └─ Archive HTTP endpoint
                                               │
                                               ▼
                                        Supabase project
                                        ├─ auth.users
                                        ├─ competition_state (one active snapshot)
                                        └─ quiz_archives (host-scoped history)
```

## 2. Runtime components

### Frontend

The application is a React 19 + Vite single-page app. `client/src/app/App.jsx` uses pathname checks and the browser history API for the landing, join, host, account and profile screens; this is not a full client-side router framework.

The frontend source is organised into `app/` for application bootstrap, `features/` for screen ownership, `services/` for external integrations, and `styles/` for shared global styling. The top-level app:
- obtains a saved Supabase session during startup;
- updates the visible session and profile state;
- supplies saved game name as a join-name prefill;
- routes signed-in users to the host UI and account/profile screens;
- preserves a confirmation prompt when browser back navigation would leave an active quiz.

Key screens:
- `features/host/Host.jsx`: host setup, CSV/manual question authoring, room controls, round configuration, elimination review, leaderboards and host archive.
- `features/participant/Participant.jsx`: guest or signed-in joining, question selection, waiting/round-break/final states and personal performance report.
- `features/account/Account.jsx`: email/password sign-up and sign-in.
- `features/profile/Profile.jsx`: player game name and bio.
- `services/auth.js`: calls Supabase Auth endpoints directly and stores the session under `cloudclash.auth.session` in local storage.
- `services/socket.js`: one shared Socket.IO client, initially disconnected.

### Backend

`server/index.js` creates:
- an Express app with CORS constrained to configured `CLIENT_ORIGIN` values;
- `GET /health` for service and active snapshot health;
- `GET /api/archives` behind verified-account middleware;
- a Socket.IO server with optional token-verification middleware;
- one process-wide active-room state machine.

The state machine is intentionally concentrated in one file. It maintains Maps/Sets for participants, answers, per-round/total stats and elimination state; timers and queues are also process-local.

`server/persistence.js` handles Supabase REST communication for active snapshots and archives. It does not expose a general-purpose database client or ORM.

## 3. Single active room model

The server stores the active room in module-level variables, not in a map of room IDs. Socket.IO rooms such as `host` and `competition` are broadcast groups for the one active competition; they are not evidence of multi-room support.

Consequences:
- only one competition can be active in a backend process;
- one backend instance is the supported deployment mode;
- multiple Node processes would each have independent timers/maps and could disagree about the live quiz;
- the `competition_state` row is one snapshot, keyed by `COMPETITION_CODE`, not a per-room database;
- adding simultaneous rooms requires a deliberate redesign of state ownership, event authorization, persistence keys, timers, and deployment coordination.

## 4. Network boundaries

### Supabase Auth

The frontend calls Supabase Auth REST endpoints for sign-up, password sign-in, refresh, logout, and user metadata updates. The browser stores access and refresh tokens in local storage. The frontend passes only the access token in Socket.IO handshake auth.

The backend independently verifies that access token using Supabase's `/auth/v1/user` endpoint and its configured publishable/anon key. It stores the verified user ID in `socket.data.userId`.

### Socket.IO

Socket.IO carries interactive gameplay and host commands. The server validates commands, mutates authoritative state, and sends acknowledgements/events. See `QUIZ-FLOW.md` for the lifecycle and event details.

### Archive HTTP API

The host dashboard requests `GET /api/archives` with its current access token. The backend verifies the token and derives the account ID; it does not accept the requested account ID from the query string or body. The backend uses the service-role key internally to read the rows.

## 5. Data and persistence paths

There are two distinct data paths:

| Data | Storage | Purpose |
|---|---|---|
| Current competition snapshot | `competition_state.state` JSONB | Restore one active/waiting/paused/finished process state |
| Completed quiz archive | `quiz_archives` rows | Host's latest five completed result summaries |
| Accounts | Supabase Auth | Email/password authentication |
| Player profile | Supabase Auth user metadata | `game_name` and `bio` |

The active snapshot includes more sensitive/transient gameplay state than the archive, including the active question bank and answer map. The archive deliberately excludes those raw question/answer details. See `DATABASE.md` and `SECURITY.md`.

## 6. Important runtime behavior

- Server health is exposed at `/health`. When persistence is enabled, health depends on successful restoration and absence of a recorded persistence error.
- In local memory-only mode, restart clears live state.
- Production persistence is enabled by default when `NODE_ENV=production`, unless `PERSISTENCE_ENABLED` explicitly overrides it.
- Archive writes are attempted when the quiz transitions to finished. They are asynchronous relative to the initial `competition_finished` event; the host receives a later archive success/error event.
- The implementation supports early host termination as a finished quiz and archives it. The archive's `completed_at` means the quiz was ended, not necessarily that every configured round naturally elapsed.
- Do not assume a multi-instance safe deployment, distributed timer system, durable event log, or participant history feature exists.

## 7. Change impact checklist

Before changing a component, ask:
- Does this alter an event name, payload, or acknowledgement contract?
- Does this touch server-authoritative state or snapshot shape/version?
- Does this change auth/ownership checks?
- Does it alter round/timer/answer sequencing?
- Does it change archive privacy, retention, or data shape?
- Does it require a new environment variable or SQL migration?
- Does the single-instance limitation still hold?
- Which docs and manual flows must be updated?
