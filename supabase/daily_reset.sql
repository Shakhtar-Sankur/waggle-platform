-- Server-side midnight reset of every driver's daily counters.
-- Runs on Supabase's scheduler (pg_cron) so a driver's "today" distance/earnings
-- go back to 0 each day even if they never open the app — so other drivers never
-- see yesterday's numbers on the leaderboard / map.
--
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

-- 1. Enable the scheduler extension (Supabase allows pg_cron).
create extension if not exists pg_cron;

-- 2. Remove any previous copy of this job so re-running doesn't duplicate it.
do $$
begin
  perform cron.unschedule('reset-daily-driver-stats');
exception
  when others then null; -- job didn't exist yet
end $$;

-- 3. Schedule the reset for 00:00 Asia/Manila every day.
--    Manila is UTC+8, so local midnight = 16:00 UTC.
select cron.schedule(
  'reset-daily-driver-stats',
  '0 16 * * *',
  $$
    update public.worker_locations
    set today_distance_km = 0,
        today_earnings = 0
    where today_distance_km <> 0 or today_earnings <> 0;
  $$
);

-- To verify it was scheduled:  select * from cron.job;
