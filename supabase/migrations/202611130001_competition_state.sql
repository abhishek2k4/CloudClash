-- CLOUD CLASH: one durable snapshot per competition.
-- Run this in the Supabase SQL Editor before enabling persistence.
create table if not exists public.competition_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.competition_state enable row level security;

-- No client-facing policies are created. The backend uses the service-role key,
-- which bypasses RLS. Never expose that key to the browser.
