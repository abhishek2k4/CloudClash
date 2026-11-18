# Quiz Lifecycle and Socket.IO Flow

This document describes the implemented model, not a proposed future design. The main implementation is in `server/index.js`; client listeners and commands are in `Host.jsx` and `Participant.jsx`.

## 1. Lifecycle at a glance

```text
Host signs in
    │
    ▼
Socket connects with access token
    │ backend verifies token and sets socket.data.userId
    ▼
host_login ── ownership/recovery check
    │
    ▼
Host configures a room and questions
    │ create_quiz
    ▼
waiting ── participants join with room code
    │
    ▼
Host starts Round 1
    │ start_round
    ▼
running ── question_started
    │
    ├─ submit_answer (server validates and scores)
    ├─ pause_question / resume_question
    └─ question timeout or host close
           │
           ▼
     question_ended → automatic next-question delay
           │
           ▼
     next question or round_break
           │
           ├─ review/confirm elimination (optional)
           └─ start next round
                   │
                   ▼
           final round ends / host ends quiz
                   │
                   ▼
                finished
                   │
                   ├─ final report/leaderboard reveal flow
                   └─ async host archive write
```

Exact event names should be checked against the live `server/index.js` before changing them. This guide lists important known contracts; it is not a generated event schema.

## 2. Connection and identity

### Host
1. The host route is protected by the frontend's signed-in session check, but that UI check is not the security boundary.
2. The shared socket obtains the current session via `getSession()` and supplies the access token in handshake auth.
3. Socket.IO middleware verifies the token against Supabase Auth and sets `socket.data.userId` and optional email.
4. The client emits `host_login`.
5. The server rejects a missing verified user ID, prevents a different account from taking over an in-progress room, and joins the `host` socket room only after the check.
6. A reconnect during an active/waiting/paused/round-break quiz can recover that host's current dashboard state. A reconnect after a finished quiz returns a clean idle host state rather than restoring the finished competition as a new active session.

### Participant
- Guest participants can connect without an account token.
- Signed-in participants can connect with an access token and use their saved profile game name as a default.
- Participant identity is bound by the server's join flow. Inspect the join handler before changing participant ID/reconnect semantics.
- Do not require participant sign-in as a side effect of host authentication changes.

## 3. Server status model

The current status values used by the state machine include:

| Status | Meaning |
|---|---|
| `idle` | No active room is being presented to the host |
| `waiting` | Room exists and can accept participants; host has not started the live question sequence |
| `running` | Quiz round is active; a question may be open or the server may be in the short inter-question transition |
| `paused` | Host paused an open question; remaining time is retained |
| `round_break` | A round ended; host can review standings/elimination and start the next round |
| `finished` | Quiz ended; final report/reveal/archive flow runs |

Do not invent additional states or assume every state can be resumed the same way. Read the handlers and restore logic for the transition being changed.

## 4. Question and answer authority

- The server chooses the active question from the configured question bank.
- Participant-facing question payloads are created by `safeQuestion()` and contain question text/options and timing/marks, not the correct option.
- The correct option and explanation are sent in the question-ended result after the question is locked.
- A question's server deadline is authoritative.
- The server locks the question before emitting its end result and waits for queued answer processing before finalizing that question.
- Answers are serialized through `answerQueue` to reduce races between simultaneous submissions and timeouts.
- A player should be able to change their selection in the UI only to the extent supported by the current server acknowledgement contract. Do not imply that the server accepts multiple answer records for a question; verify the handler before changing behavior.
- Do not accept client-calculated score, correctness, answer elapsed time, or deadline as authoritative input.

## 5. Rounds, scoring and tie-breaks

The host configures each round's question duration and point value. The server owns these values. Correct answers receive the configured base marks plus any configured speed bonus. Incorrect and unanswered questions receive zero; there is no negative marking in the current product behavior.

Leaderboard ordering is determined by the server:
1. higher total score;
2. higher number of correct answers;
3. lower total response time;
4. participant name as a stable final ordering.

Scoring precision and speed-bonus calculations are implementation details; inspect the current calculation before modifying it. Do not reimplement scoring in the client.

## 6. Elimination

Elimination is optional and host-configurable. At a round break:
- the server calculates candidates using the configured keep count;
- exact ties at the cutoff are treated specially so tied participants are not arbitrarily split;
- the host reviews and confirms the candidate eliminations;
- eliminated participants may remain connected as spectators, but the server must reject their subsequent answer submissions.

Never rely only on hiding the answer UI for eliminated players. Enforcement must remain server-side.

## 7. Host controls and transition requirements

Host commands include room creation, question import/configuration, starting rounds, pause/resume, ending the current question/quiz, elimination confirmation and result reveal. The host can end the quiz during an active round or at a round break; the server finalizes the current standings, sends participants to the results flow and attempts the normal archive write. Find exact event names and payloads in `server/index.js`.

When adding/modifying a command:
- validate host ownership and status on the server;
- validate all numeric settings and round/question indexes;
- acknowledge failure explicitly;
- broadcast state changes only after the server accepts the mutation;
- persist when a durable snapshot should reflect the change;
- make repeated finish/transition calls safe where practical;
- keep host UI state synchronized from server events.

## 8. Completion and archives

When the quiz transitions to `finished`, the server builds the final leaderboard/analytics and attempts an archive write if room ownership and room code are present. Archive writing is asynchronous; `competition_finished` can arrive before `quiz_archived` or `quiz_archive_error`.

The archive stores summary results and settings/round question counts. It does not store question text/options or individual answer history. The archive RPC upserts by host plus room code and prunes older rows beyond five per host.

The current code also treats a host-ended quiz as finished and archives it. A room cancelled before starting is not archived. Preserve this unless product requirements change.

## 9. Reconnect and persistence checklist

Before changing connection or lifecycle code, manually verify:
- host reconnect during `waiting`;
- host reconnect during `running` with an open question;
- host reconnect during `paused`;
- host reconnect during `round_break`;
- host reconnect after `finished`;
- participant reconnect and identity restoration;
- participant reconnect after elimination;
- server restart in memory-only mode;
- server restart with snapshot persistence enabled;
- archive success and archive failure handling.

A successful frontend build does not validate these behaviors.
