create table if not exists public.quiz_archives (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  room_name text not null,
  room_code text not null,
  rounds integer not null,
  completed_at timestamptz not null default now(),
  participant_count integer not null default 0,
  leaderboard jsonb not null default '[]'::jsonb,
  quiz_settings jsonb not null default '{}'::jsonb,
  question_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (host_user_id, room_code)
);

create index if not exists quiz_archives_host_completed_idx
  on public.quiz_archives (host_user_id, completed_at desc);

alter table public.quiz_archives enable row level security;
revoke all on public.quiz_archives from anon, authenticated;
grant all on public.quiz_archives to service_role;

create or replace function public.archive_completed_quiz(archive_payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_id uuid;
  removed_count integer;
begin
  insert into public.quiz_archives (
    host_user_id, room_name, room_code, rounds, completed_at,
    participant_count, leaderboard, quiz_settings, question_counts
  ) values (
    (archive_payload->>'host_user_id')::uuid,
    coalesce(archive_payload->>'room_name', 'Untitled quiz'),
    archive_payload->>'room_code',
    (archive_payload->>'rounds')::integer,
    coalesce((archive_payload->>'completed_at')::timestamptz, now()),
    coalesce((archive_payload->>'participant_count')::integer, 0),
    coalesce(archive_payload->'leaderboard', '[]'::jsonb),
    coalesce(archive_payload->'quiz_settings', '{}'::jsonb),
    coalesce(archive_payload->'question_counts', '{}'::jsonb)
  )
  on conflict (host_user_id, room_code) do update set
    room_name = excluded.room_name,
    rounds = excluded.rounds,
    completed_at = excluded.completed_at,
    participant_count = excluded.participant_count,
    leaderboard = excluded.leaderboard,
    quiz_settings = excluded.quiz_settings,
    question_counts = excluded.question_counts
  returning id into saved_id;

  delete from public.quiz_archives
  where host_user_id = (archive_payload->>'host_user_id')::uuid
    and id in (
      select id from public.quiz_archives
      where host_user_id = (archive_payload->>'host_user_id')::uuid
      order by completed_at desc, id desc
      offset 5
    );
  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;

revoke all on function public.archive_completed_quiz(jsonb) from public, anon, authenticated;
grant execute on function public.archive_completed_quiz(jsonb) to service_role;
