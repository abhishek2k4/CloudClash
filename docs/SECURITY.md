# Security and Trust Boundaries

This document records the current security design and the constraints future changes must preserve. It is not a substitute for a formal security audit.

## 1. Credentials

| Credential | Location | Use | Browser exposure |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Frontend build env | Supabase project endpoint | Public |
| `VITE_SUPABASE_ANON_KEY` | Frontend build env | Supabase Auth client requests | Public/publishable |
| `SUPABASE_URL` | Backend env | Supabase REST/Auth endpoint | No |
| `SUPABASE_ANON_KEY` | Backend env | Verifies bearer tokens through Auth user endpoint | No need to expose |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend env only | Server-side snapshot and archive database calls | **Never** |

A Vite variable is embedded into the browser build. Never prefix the service-role key with `VITE_`.

## 2. Authentication

The frontend directly calls Supabase Auth REST endpoints for:
- email/password sign-up;
- password sign-in;
- refresh-token grant;
- logout;
- profile metadata update.

The browser stores the session in local storage under `cloudclash.auth.session`. Access-token expiry is checked and a refresh attempt is made before returning an expired session.

The backend does not trust the frontend's stored user object. It verifies the access token with Supabase Auth's `/auth/v1/user` endpoint using the server's configured anon/publishable key. The verified user ID is the identity attached to the server request or socket.

## 3. Host authorization

A signed-in UI route is not enough to authorize host operations. The server:
- rejects a `host_login` without a verified socket user ID;
- associates room ownership with the verified user ID when creating a quiz;
- checks that the current host account owns the active room before allowing protected host controls;
- blocks another account from taking over an in-progress room.

Every new host command must use the same server-side authorization model. Do not rely on a hidden button or a route guard.

## 4. Guest participants

A Socket.IO connection without an access token is allowed so guests can join competitions. If a token is supplied, the backend attempts to verify it; an invalid supplied token is rejected rather than silently downgraded to guest. Preserve guest joining when working on auth.

Participant identity and reconnect behavior must be checked in the existing join handler before changing it. Never use an arbitrary client-provided participant ID as identity proof without verifying the corresponding server-side participant record.

## 5. Database controls

- RLS is enabled on `competition_state` and `quiz_archives`.
- No direct client-facing policies are created in the supplied schema.
- The archive table revokes table privileges from `anon` and `authenticated`.
- The archive RPC is executable only by `service_role`.
- The backend service-role key bypasses RLS; it therefore requires strict server-side authorization and must never enter a client response.

When adding a Supabase table, document its RLS policy and expected caller. Avoid broad policies such as unrestricted select/insert/update/delete.

## 6. API and event boundaries

- `GET /api/archives` requires a bearer access token.
- The backend derives the owner ID from the verified Supabase user response.
- The archive list response contains only the fields selected by `listQuizArchives`.
- Gameplay commands pass through server validation; client timestamps, points, correctness, host identity and ownership claims are untrusted.

Keep error responses useful but do not include secrets, authorization headers, access tokens, refresh tokens or sensitive raw database details in user-visible messages.

## 7. Data minimization

The active snapshot may contain the question bank and answer records because it is needed to restore gameplay. The completed archive is deliberately smaller: quiz metadata, final leaderboard and aggregate/round-wise analytics. Do not expand archive contents to include raw question or per-question answer history without a clear product/privacy decision.

Avoid logging participant answer content or credentials. Use synthetic data in test tools.

## 8. Security review checklist

For any auth, database, API, socket or archive change, check:
- Is identity derived from a verified token?
- Does the server perform the authorization check?
- Can a participant invoke a host action?
- Can one host read another host's archive?
- Does any browser bundle or API response expose a service-role credential?
- Are direct database access and RLS still restrictive?
- Can untrusted client values alter scores, deadlines or correctness?
- Are error messages/logs leaking sensitive values?
- Does the change increase archived personal data unnecessarily?
