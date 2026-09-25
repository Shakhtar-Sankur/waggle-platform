-- ============================================================================
-- Waggle Gig: dispatch, nearby jobs and online availability.
-- Paste the whole file into the Supabase SQL Editor and press Run, once.
-- Order matters and is already correct. Safe to run again.
-- Needs 00_complete_backend.sql to have been run first (the jobs table).
-- ============================================================================

-- Dispatch: a merchant can send a job, and a job can only be accepted once.
--
-- Run after 00_complete_backend.sql. Safe to re-run.
--
-- Two things are added here:
--   1. Jobs get an author (created_by) and Waggle's own routing fee, so the
--      platform fee is recorded on the job it was charged for. Money that moves
--      between the customer and the driver is deliberately NOT modelled here:
--      Waggle's income is the fee, not the fare.
--   2. Accepting is moved into a function and the update policy is narrowed, so
--      two drivers pressing Accept in the same second cannot both get the job.
--      Before this, the policy allowed any authenticated driver to update any
--      unassigned job, and the second write simply overwrote the first.

alter table public.jobs add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.jobs add column if not exists fee_paise integer not null default 0;
alter table public.jobs add column if not exists note text;
alter table public.jobs add column if not exists accepted_at timestamptz;

create index if not exists idx_jobs_created_by on public.jobs (created_by);

-- A merchant keeps sight of the job after a driver takes it; a driver still
-- sees open jobs and their own.
drop policy if exists "jobs readable" on public.jobs;
create policy "jobs readable" on public.jobs
  for select to authenticated using (
    assigned_to is null
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  );

-- No one may post a job directly yet. Jobs will be created by Waggle Business
-- through a function that checks the business, once businesses exist as a role.
-- (An earlier version let any signed-in account post jobs; it was removed on
-- September 23, 2026, and this line keeps it removed on every re-run.)
drop policy if exists "jobs insert own" on public.jobs;

-- Narrowed: you may change a job you already hold, or one you created.
-- Claiming an unassigned job is no longer possible with a plain update — it
-- goes through accept_job() below, which is the only place the claim happens.
drop policy if exists "jobs update assignee" on public.jobs;
create policy "jobs update assignee" on public.jobs
  for update using (assigned_to = auth.uid() or created_by = auth.uid())
  with check (assigned_to = auth.uid() or created_by = auth.uid());

-- First accept wins.
--
-- The WHERE clause carries the whole rule: the row is only updated while it is
-- still open and unassigned. Postgres takes a row lock for the update, so the
-- second caller waits, re-reads the row, finds status = 'accepted' and matches
-- nothing. It returns no row, and the app tells that driver the job is gone
-- rather than sending two people to one pickup.
create or replace function public.accept_job(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.jobs;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  update public.jobs
     set status = 'accepted',
         assigned_to = auth.uid(),
         accepted_at = now(),
         updated_at = now()
   where id = p_job_id
     and status = 'open'
     and assigned_to is null
  returning * into claimed;

  return claimed;   -- null when somebody else got there first
end;
$$;

revoke all on function public.accept_job(uuid) from public, anon;
grant execute on function public.accept_job(uuid) to authenticated;


-- Jobs near the driver, and nothing else.
--
-- Run after dispatch.sql. Safe to re-run.
--
-- Until now loadJobs() returned every unassigned job in the table, so a rider
-- in Bhubaneswar was offered a parcel in Mumbai. A job now carries the
-- coordinates of its pick-up, and drivers ask for the ones within a radius of
-- where they are.
--
-- No PostGIS: this is a plain haversine in SQL. A bounding box on latitude
-- narrows the rows first so the index does the work and the trigonometry only
-- runs on what survives. At city scale that is fast enough, and it keeps the
-- schema portable to any Postgres.

alter table public.jobs add column if not exists pickup_lat double precision;
alter table public.jobs add column if not exists pickup_lng double precision;

create index if not exists idx_jobs_open_pickup on public.jobs (status, pickup_lat, pickup_lng)
  where status = 'open' and assigned_to is null;

/** Great-circle distance in kilometres. */
create or replace function public.km_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
parallel safe
as $$
  select 2 * 6371 * asin(
    sqrt(
      sin(radians(lat2 - lat1) / 2) ^ 2
      + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
    )
  );
$$;

/**
 * Open jobs whose pick-up is within p_radius_km of the driver, nearest first.
 *
 * SECURITY INVOKER on purpose: the caller's own row-level security still
 * applies, so this cannot be used to read jobs somebody else already holds.
 * Jobs with no coordinates are left out rather than shown to everyone — a job
 * with an unknown pick-up is exactly the one a driver should not be sent to.
 */
create or replace function public.jobs_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 12,
  p_limit integer default 50
)
returns table (job public.jobs, distance_km double precision)
language sql
stable
as $$
  select j, public.km_between(p_lat, p_lng, j.pickup_lat, j.pickup_lng) as distance_km
    from public.jobs j
   where j.status = 'open'
     and j.assigned_to is null
     and j.pickup_lat is not null
     and j.pickup_lng is not null
     -- cheap box first: one degree of latitude is ~111 km everywhere
     and j.pickup_lat between p_lat - (p_radius_km / 111.0) and p_lat + (p_radius_km / 111.0)
     and public.km_between(p_lat, p_lng, j.pickup_lat, j.pickup_lng) <= p_radius_km
   order by distance_km
   limit p_limit;
$$;

revoke all on function public.jobs_nearby(double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.jobs_nearby(double precision, double precision, double precision, integer) to authenticated;
grant execute on function public.km_between(double precision, double precision, double precision, double precision) to authenticated;


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
