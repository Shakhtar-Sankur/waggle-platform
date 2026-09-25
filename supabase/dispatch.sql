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
