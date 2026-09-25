-- Online / offline: which workers are available for a job, and where they are.
--
-- Run after dispatch_nearby.sql. Safe to re-run.
--
-- Kept apart from worker_locations on purpose. That table is the social map —
-- where a driver is for their friends, while they choose to share it. This one
-- is operational: a worker who is online is asking to be offered work, and
-- dispatch needs to know where they are to do that. The two are different
-- consents, and one switch should not quietly turn on the other.
--
-- Only the worker can read or write their own row. Nobody browses who is online;
-- the future dispatch function reads this table as the database, not as a user.

create table if not exists public.worker_availability (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  online boolean not null default false,
  lat double precision,
  lng double precision,
  online_since timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_worker_availability_online
  on public.worker_availability (online, updated_at desc)
  where online;

alter table public.worker_availability enable row level security;

drop policy if exists "availability own read" on public.worker_availability;
create policy "availability own read" on public.worker_availability
  for select using (user_id = auth.uid());

drop policy if exists "availability own insert" on public.worker_availability;
create policy "availability own insert" on public.worker_availability
  for insert with check (user_id = auth.uid());

drop policy if exists "availability own update" on public.worker_availability;
create policy "availability own update" on public.worker_availability
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A worker who closes the app without going offline must not stay "available"
-- for ever. Anything not refreshed in 15 minutes is treated as offline by
-- whatever reads this table; the app refreshes the row while it is open.
create or replace view public.workers_available as
  select user_id, lat, lng, online_since, updated_at
    from public.worker_availability
   where online
     and updated_at > now() - interval '15 minutes'
     and lat is not null
     and lng is not null;

revoke all on public.workers_available from anon, authenticated;
