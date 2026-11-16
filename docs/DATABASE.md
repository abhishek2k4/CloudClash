# Database and Persistence

## 1. Supabase resources

CloudClash currently uses Supabase Auth and two Postgres tables:

- `public.competition_state`: one durable JSON snapshot for the active competition.
- `public.quiz_archives`: completed quiz summaries, scoped to a host account.

No ORM is used. The backend calls Supabase REST endpoints directly using `fetch`.

## 2. Competition snapshot

Schema source: `supabase/migrations/202611130001_competition_state.sql`.

| Column | Type | Purpose |
|---|---|---|
| `id` | text primary key | Snapshot key, set from `COMPETITION_CODE` |
| `state` | jsonb | Serialized server state |
| `updated_at` | timestamptz | Last write time |

The table has RLS enabled and no client-facing policies. The backend accesses it with the service-role key, which bypasses RLS.

The snapshot is produced by `snapshot()` in `server/index.js`. It currently includes room identity/owner, rounds and settings, active questions, participants, answer map, statistics, eliminated IDs, status, active round/question position and timer/lock fields. Treat it as sensitive operational state, not a public archive.

The snapshot has a version field. The restore logic currently accepts snapshot versions 2 and 3. Before changing its shape, inspect the restore migration/compatibility path and existing live data. Do not casually remove old-version handling.

## 3. Completed quiz archives

Schema source: `server/supabase/quiz-archives.sql`.

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid | Archive row ID |
| `host_user_id` | uuid | Supabase Auth user ID; cascades on account deletion |
| `room_name` | text | Display name of quiz |
| `room_code` | text | Competition code; unique per host |
| `rounds` | integer | Configured round count |
| `completed_at` | timestamptz | Time the quiz entered finished state |
| `participant_count` | integer | Number of participants at finish |
| `leaderboard` | jsonb | Final ranked participant performance |
| `quiz_settings` | jsonb | Settings captured at finish |
| `question_counts` | jsonb | Number of questions per round |
| `created_at` | timestamptz | Row creation time |

The leaderboard JSON currently includes participant ID, display name, rank, score, correct count, total response time, elimination state, aggregate analytics and round-wise analytics. Aggregate analytics include attempted/correct/wrong, accuracy, average response time, fastest correct response, base points, speed bonus and best streak.

### Explicit archive exclusions

The archive payload does not include:
- question text or options;
- correct answer values;
- explanations;
- an itemized answer-by-answer history;
- full question bank.

The server uses answer records in memory to calculate aggregate performance, then archives the resulting summary. Do not add raw answer entries to the archive simply because they are available in the active state.

## 4. Retention and idempotency

The SQL RPC `archive_completed_quiz(archive_payload jsonb)`:
1. inserts an archive row;
2. upserts if the same host and room code already exists;
3. removes older rows for that host beyond the newest five;
4. returns the number of removed rows.

The uniqueness constraint is `(host_user_id, room_code)`. Retention is performed in the database, not only in the UI. The read API also requests at most five rows sorted newest first.

This is host-only history. There is no participant-wide archive API or per-participant historical timeline.

## 5. Access control

RLS is enabled on both tables. The schema intentionally grants no direct archive table privileges to `anon` or `authenticated`; the service role has access. The archive function's execute permission is revoked from public/anon/authenticated and granted to `service_role`.

The backend:
- verifies the request's bearer token with Supabase Auth;
- derives `req.accountId` from the verified user object;
- calls `listQuizArchives(req.accountId)`;
- calls the archive RPC using a server-only service-role credential.

Never accept a caller-supplied `host_user_id` as proof of access.

## 6. Persistence enablement

The active snapshot is enabled when both:
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present; and
- `PERSISTENCE_ENABLED` resolves to true.

When `PERSISTENCE_ENABLED` is unset, production mode defaults to enabling snapshot persistence; non-production defaults to disabled. An explicit `PERSISTENCE_ENABLED=false` disables the active snapshot path even when credentials exist.

Archive helpers separately require Supabase URL and service-role credentials. This means archives can be configured independently of whether active snapshot persistence is enabled.

## 7. SQL setup order

1. Create/configure the Supabase project and enable Email auth provider.
2. Run `supabase/migrations/202611130001_competition_state.sql` in the Supabase SQL Editor before enabling active competition persistence.
3. Run `server/supabase/quiz-archives.sql` to enable completed quiz archives.
4. Configure backend environment values securely.
5. Verify `/health`, host authentication, archive retrieval and a complete test quiz.

Do not rerun a modified schema manually in production without reviewing the effects on existing rows and functions.

## 8. Data lifecycle summary

| Lifecycle | Data lifetime |
|---|---|
| Active question bank and answer map | In-memory while active; may be included in the durable active snapshot |
| Participant live stats | In-memory and part of active snapshot; final aggregates copied to archive |
| Finished host archive | Newest five per host retained |
| Auth user and profile metadata | Managed by Supabase Auth until account deletion |
| Guest participant profile | No cross-quiz account history |

Keep this distinction intact when adding analytics, exports, or history screens.
