# Frontend Agent Instructions

Read the repository root `AGENTS.md` first. This file adds frontend-specific constraints.

## Source layout

- `src/app/`: application bootstrap and top-level navigation.
- `src/features/`: feature-owned screens and UI (host, participant, account, profile).
- `src/services/`: external integrations such as Supabase Auth and Socket.IO.
- `src/styles/global.css`: existing application-wide styles during the incremental CSS migration.
- `src/index.css`: baseline reset and root sizing.

Keep new feature-specific components and styles inside their owning feature. Use CSS Modules for component-scoped styles as components are extracted; do not move existing selectors blindly when ownership is shared.

## Responsibilities and boundaries

- `app/App.jsx` owns top-level navigation, auth bootstrap, the current signed-in session/profile state and the shared join prefill.
- `features/host/Host.jsx` owns the host-facing setup, question authoring/import, archive display, room controls, round transitions and host leaderboard presentation.
- `features/participant/Participant.jsx` owns guest/signed-in participant entry, live question interaction, round/final reports and participant-side status.
- `features/account/Account.jsx` and `features/profile/Profile.jsx` are UI surfaces; auth and profile network/session logic belongs in `services/auth.js`.
- `services/socket.js` exports the shared Socket.IO client used by the application.

Follow the existing structure unless a task requires a deliberate refactor. Avoid splitting files or introducing state-management libraries just to make a narrow change.

## Security and trust

- Treat all browser state as untrusted and presentation-only.
- Never calculate authoritative score, correctness, elimination, or timer expiry in the client.
- Never infer host privileges from a route, button visibility, local storage, email address, or a client-supplied user ID. The server must authorize host actions.
- Only send the current Supabase access token in Socket.IO auth when needed. Do not send refresh tokens to the backend.
- Never import server environment variables or the Supabase service-role key into client code.
- The frontend Supabase anon/publishable key is public configuration; it is not authorization by itself.

## Socket.IO lifecycle

- The shared socket is configured with `autoConnect: false`; screens connect/disconnect or register handlers as part of their lifecycle.
- Register event listeners before relying on events and remove the same listeners during cleanup.
- Avoid registering duplicate listeners on rerenders.
- Handle disconnects and connect errors without assuming the server accepted an action.
- Use server acknowledgements and broadcasts as the source for state transitions.
- Preserve participant reconnection behavior and host recovery semantics when touching connection code.
- Do not reuse stale room/participant state after a completed quiz or an intentional exit.

## UI behavior

- Preserve keyboard-accessible native controls and existing loading/error/empty states.
- Keep the host dashboard usable during a live event; avoid blocking controls with unnecessary async work.
- Keep guest joining available. Do not accidentally make participant sign-in mandatory.
- Keep archive visibility host-only and use the authenticated archive endpoint.
- Avoid showing hidden answers or authoritative state early merely to simplify UI logic.
- Follow existing CSS naming and shared styles in `App.css`; avoid adding a second styling framework without approval.

## Validation

From `client/`:
```bash
npm ci
npm run build
npm run lint
```

The CI workflow currently runs the production build but does not run ESLint. If a change touches gameplay, manually rehearse the corresponding browser flow against the backend; a successful Vite build does not validate Socket.IO behavior.
