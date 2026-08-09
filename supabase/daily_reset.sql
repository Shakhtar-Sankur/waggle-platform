-- Server-side reset of every driver's daily counters, at THEIR midnight.
--
-- The previous version fired once a day at 16:00 UTC, because that is midnight
-- in Manila. That was right when every driver was in the Philippines. It is
-- wrong now: a driver in São Paulo had their day cleared at 1pm, and one in
-- Mumbai at 9:30pm — mid-shift, with earnings on screen.
--
-- "Midnight" is not one moment across 49 countries, so the job now runs every
-- hour and resets only the drivers whose own day has actually turned over.
--
-- Run once in the SQL editor. Safe to re-run.

-- ---------------------------------------------------------------- timezone
-- The client sends an IANA name (Asia/Kolkata, America/Sao_Paulo) when it has
-- one. Rows written before this column existed simply do not have it yet.
alter table public.worker_locations add column if not exists timezone text;

-- ------------------------------------------------------------- local date
-- What calendar day was it, for this driver, at this instant?
--
-- Prefers the reported IANA zone. Falls back to longitude — the earth turns 15
-- degrees an hour — which is roughly right everywhere and exactly right nowhere,
-- but is far better than assuming Manila. An unparseable zone falls back too,
-- rather than taking the whole job down.
create or replace function public.driver_local_date(
  p_at timestamptz,
  p_timezone text,
  p_lng double precision
)
returns date
language plpgsql
immutable
as $$
begin
  if p_timezone is not null and p_timezone <> '' then
    begin
      return (p_at at time zone p_timezone)::date;
    exception when others then
      -- unknown zone name; fall through to the longitude estimate
      null;
    end;
  end if;

  return (
    p_at at time zone make_interval(
      hours => greatest(-12, least(14, round(coalesce(p_lng, 0) / 15.0)::int))
    )
  )::date;
end $$;

-- ------------------------------------------------------------------ reset
create or replace function public.reset_stale_daily_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  update public.worker_locations
     set today_distance_km = 0,
         today_earnings = 0
   where (coalesce(today_distance_km, 0) <> 0 or coalesce(today_earnings, 0) <> 0)
     -- The driver's local day has moved on since their last update.
     and public.driver_local_date(now(), timezone, lng)
       > public.driver_local_date(updated_at, timezone, lng);

  get diagnostics touched = row_count;
  return touched;
end $$;

revoke all on function public.reset_stale_daily_stats() from public, anon, authenticated;

-- -------------------------------------------------------------- scheduling
-- Hourly, because every hour is midnight somewhere. Wrapped: pg_cron is not on
-- every plan, and this must never take the rest of a migration down with it.
do $$
begin
  create extension if not exists pg_cron;

  begin
    perform cron.unschedule('reset-daily-driver-stats');
  exception when others then null;
  end;

  perform cron.schedule(
    'reset-daily-driver-stats',
    '5 * * * *',                       -- five past each hour
    $job$ select public.reset_stale_daily_stats(); $job$
  );

  raise notice 'Daily reset scheduled hourly; each driver resets at their own midnight.';
exception when others then
  raise notice 'pg_cron unavailable (%). Skipping the schedule — the client-side reset still applies.', sqlerrm;
end $$;

-- Check it:
--   select jobname, schedule, active from cron.job
--    where jobname = 'reset-daily-driver-stats';
--
-- Try it by hand (returns how many drivers were reset):
--   select public.reset_stale_daily_stats();
