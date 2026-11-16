# Local Setup, Environment and Deployment

## 1. Runtime requirements

The root README specifies Node.js 20.19+ or 22.12+ and npm. CI currently uses Node.js 22.

The repository contains two npm applications:
- `server/`: Express + Socket.IO backend.
- `client/`: React + Vite frontend.

Install dependencies separately in each directory. There is no root workspace script.

## 2. Backend environment

Copy `server/.env.example` to `server/.env`.

| Variable | Required? | Purpose |
|---|---|---|
| `PORT` | Optional | HTTP/Socket.IO listen port; current default is 5000 |
| `CLIENT_ORIGIN` | Yes for deployed frontend access | Comma-separated allowed frontend origin(s) for CORS |
| `PERSISTENCE_ENABLED` | Optional | Explicitly enables/disables active competition snapshot persistence |
| `SUPABASE_URL` | Required for Supabase features | Supabase project URL |
| `SUPABASE_ANON_KEY` | Required for token verification | Supabase publishable/anon key used by backend Auth user endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Required for snapshot/archive database access | Server-only secret key |
| `COMPETITION_CODE` | Optional | Identifier for the one active snapshot; defaults to `CLOUD26` in persistence module |
| `NODE_ENV` | Platform/runtime | When `PERSISTENCE_ENABLED` is unset, production enables persistence by default |

Important configuration behavior:
- If `PERSISTENCE_ENABLED` is explicitly set, only the string `true` enables snapshot persistence.
- If it is unset, production mode requests persistence; other environments do not.
- Snapshot persistence also needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Archive read/write helpers require the Supabase URL and service-role key even when snapshot persistence is disabled.
- Never copy the service-role key into frontend environment settings.

## 3. Frontend environment

Copy `client/.env.example` to `client/.env`.

| Variable | Purpose |
|---|---|
| `VITE_SERVER_URL` | Backend URL used by Socket.IO |
| `VITE_SUPABASE_URL` | Supabase URL used for account/profile Auth requests |
| `VITE_SUPABASE_ANON_KEY` | Public/publishable Supabase Auth key |

The frontend must use the same Supabase project as the backend. Only the anon/publishable key belongs in the frontend. All `VITE_*` values are shipped to browsers.

## 4. SQL prerequisites

Before using persistence features:
1. Run `supabase/migrations/202611130001_competition_state.sql` to create the active competition snapshot table.
2. Run `server/supabase/quiz-archives.sql` to create the archive table and retention RPC.
3. Confirm Supabase Email Auth is enabled.
4. Configure the environment values and test the backend health endpoint.

The README and current SQL files are the authoritative setup references; do not invent additional migration steps.

## 5. Local development

Backend:
```powershell
cd server
npm install
npm run dev
```

Frontend in another terminal:
```powershell
cd client
npm install
npm run dev
```

Open the Vite URL printed by the dev server. The frontend expects `VITE_SERVER_URL` to target the backend. The backend health endpoint is `http://localhost:5000/health` with the default port.

Local development defaults to memory-only mode unless `PERSISTENCE_ENABLED=true` is set. In memory-only mode, backend restart clears the current competition.

## 6. Render backend target

Current documented settings:
- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Configure `CLIENT_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `NODE_ENV=production`.
- Keep a single backend instance.

Check platform behavior and current environment settings before changing deployment. The single-instance requirement is architectural, not merely a hosting preference.

## 7. Vercel frontend target

Current documented settings:
- Root directory: `client`
- Build command: `npm run build`
- Output directory: `dist`
- Set `VITE_SERVER_URL` to the deployed backend URL.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the matching Supabase project.

## 8. Pre-event checklist

- [ ] Frontend points to the intended backend.
- [ ] Backend CORS allows the deployed frontend origin.
- [ ] Supabase URL and keys refer to the same project.
- [ ] SQL snapshot migration has been applied.
- [ ] Archive SQL has been applied if host archives are required.
- [ ] Email provider is enabled and confirmation behavior is understood.
- [ ] `/health` reports healthy after persistence setup.
- [ ] Host can sign in and create a room.
- [ ] Guest and signed-in participants can join.
- [ ] CSV/manual authoring works.
- [ ] Pause/resume, question transition, round break, elimination and final reveal work.
- [ ] Host archive is saved and isolated to the account.
- [ ] Reconnect and restart expectations have been rehearsed.
- [ ] Only one backend instance is running.
