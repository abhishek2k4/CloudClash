# Architecture Decisions and Constraints

This is a lightweight decision record for choices that materially affect future implementation. Add new entries when an architectural trade-off is made.

## D-001 — One active competition room

**Decision:** The backend uses one process-wide competition state, not a collection of independently addressable rooms.

**Reason/context:** The application is currently optimized for a single host-led live event and a free-tier-friendly deployment.

**Consequences:** One backend instance is supported. Multi-room and horizontal scaling require a coordinated redesign of state, timers, broadcasts, persistence keys and ownership.

**Revisit when:** Product requirements explicitly require overlapping competitions.

## D-002 — Server-authoritative gameplay

**Decision:** Backend owns question progression, deadlines, answer acceptance, scoring, elimination and leaderboard order.

**Reason/context:** Client-only enforcement would allow manipulated timers and scores and would produce inconsistent results across participants.

**Consequences:** UI components render server events and acknowledgements; gameplay changes must be implemented and validated in the server state machine.

## D-003 — Supabase Auth for hosts; guest access for participants

**Decision:** Hosting requires a verified signed-in account. Participants may join without an account; signed-in participant identity is optional.

**Reason/context:** Host archives require account ownership while event participants should face minimal joining friction.

**Consequences:** Keep a deliberate distinction between host authorization and guest participant access. Do not make all participant connections authenticated by default.

## D-004 — Two persistence paths

**Decision:** The active competition snapshot and completed quiz archive are separate Supabase tables and lifecycle paths.

**Reason/context:** Live recovery needs richer transient state; host history needs only compact final results.

**Consequences:** Do not use an archive row as an active session snapshot or return active question/answer state from the archive API.

## D-005 — Five latest completed archives per host

**Decision:** Keep the newest five completed quiz summaries per host account.

**Reason/context:** Provides useful host history while limiting database growth on free-tier infrastructure.

**Consequences:** Enforce retention at database level and request at most five rows in the API. Keep account isolation.

## D-006 — Archive data minimization

**Decision:** Archive final leaderboard and performance analytics with minimal quiz metadata; omit question banks and answer-by-answer history.

**Reason/context:** The host needs final results, not a replayable record of every question or response.

**Consequences:** Do not add raw question or response logs to archive payloads or JSONB. New analytics must be computed before archive write and reviewed for necessity.

## D-007 — Direct Supabase Auth REST calls

**Decision:** Frontend auth currently uses the Supabase Auth REST endpoints directly instead of a Supabase JavaScript SDK.

**Reason/context:** The repository has a small, explicit auth/session module and limited account/profile needs.

**Consequences:** Session refresh, local storage behavior, API errors and token forwarding are explicitly implemented in `client/src/auth.js`. Do not assume SDK-managed session behavior.

## D-008 — Keep hosting simple and free-tier-friendly

**Decision:** Current deployment targets are Vercel for the frontend and Render for the backend, with a single server instance.

**Reason/context:** This is a portfolio/event platform with budget constraints.

**Consequences:** Avoid paid queues, managed realtime infrastructure, extra database services or multi-instance assumptions without an explicit decision.
