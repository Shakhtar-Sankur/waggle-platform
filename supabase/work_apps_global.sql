-- Buzz Buzz — allow work platforms beyond the original six Philippine apps.
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- WHY THIS IS REQUIRED:
--   driver_settings.active_app and jobs.app were created with a hard CHECK:
--       check (active_app in ('grab','angkas','moveit','joyride','foodpanda','others'))
--   The app now offers Uber, Ola, Swiggy, Zomato, Amazon Flex, Flipkart,
--   Rapido, Blinkit, Zepto, Gojek, Bolt, Careem, DoorDash, Deliveroo and more.
--   WITHOUT this migration, a driver who picks any new platform gets their
--   settings save REJECTED by Postgres (23514 check_violation) — the choice
--   silently fails to sync and reverts on their next device.
--
-- WHY WE DROP THE CHECK RATHER THAN EXTEND IT:
--   The platform list is a fast-moving, per-country catalogue — new delivery
--   apps appear constantly. Pinning it in a CHECK means a database migration
--   every time a country is added, and a hard failure for anyone who updates
--   the app before the migration runs. The allowed set is enforced in the
--   client by the WorkAppId TypeScript union, and RLS already restricts every
--   write to the row's own owner, so a free-text column is the right trade.

-- ---------------------------------------------------------------------------
-- 1. driver_settings.active_app — drop the constraint whatever it is named.
--    (Named constraints differ between projects, so find it dynamically.)
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname, rel.relname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and con.contype = 'c'
       and rel.relname in ('driver_settings', 'jobs')
       and pg_get_constraintdef(con.oid) ilike '%grab%'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
    raise notice 'dropped % on %', c.conname, c.relname;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Keep the columns sane: still text, still required where it was required.
--    (No-ops if already correct — included so a fresh database matches.)
-- ---------------------------------------------------------------------------
alter table public.driver_settings alter column active_app type text;
alter table public.jobs           alter column app        type text;

-- ---------------------------------------------------------------------------
-- 3. Verify — should return NO rows mentioning the old six-app list.
-- ---------------------------------------------------------------------------
select rel.relname as table_name,
       con.conname as constraint_name,
       pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
 where nsp.nspname = 'public'
   and con.contype = 'c'
   and rel.relname in ('driver_settings', 'jobs');
