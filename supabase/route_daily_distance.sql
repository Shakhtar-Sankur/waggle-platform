-- Per-day distance, computed in the database instead of on the phone.
--
-- The 7-day record and the earnings report used to fetch raw route_points and
-- add them up in the client. That works on a test account and fails on a real
-- driver, badly enough to be worth spelling out:
--
--   TripTrackingService emits a fix every 2 seconds while moving, and every
--   accepted fix writes one row. An 8-hour shift is ~14,400 rows a day, so a
--   month of work is ~430,000 rows. The client query capped at 20,000 and
--   ordered ASCENDING, so it returned the OLDEST 20,000 rows in the window —
--   about a day and a half from four weeks ago — and the last seven days came
--   back empty. Seeded with six realistic shifts, the app reported 6.9 km for
--   the week and 0.0 km for six days out of seven, today included.
--
--   Raising the cap is not the fix. Pulling 430,000 rows to a handset is the
--   opposite of what this app is for: it is built for a mid-range phone on a
--   prepaid plan. The right answer is to send back seven numbers.
--
-- The distance rules are the ones LocationService.routeDistanceKm applies, and
-- they have to stay that way or the map and the record will disagree about the
-- same day:
--
--   * a segment spanning more than SESSION_GAP_MS (5 minutes) is a gap between
--     two shifts, not a drive across town, so it is skipped;
--   * a segment implying more than MAX_PLAUSIBLE_KMH (200) is a GPS glitch
--     inside one session, so it is skipped;
--   * everything else counts.
--
-- Days are bucketed in the DRIVER's timezone, passed in by the caller, because
-- "how far did I go on Tuesday" means their Tuesday. Bucketing in UTC would
-- move part of every evening shift into the next day for anyone east of London.
--
-- SECURITY INVOKER, deliberately: the function runs as the caller, so the
-- existing row-level policy on route_points ("route own", auth.uid() =
-- user_id) is what keeps one driver's history out of another's totals. A
-- SECURITY DEFINER function here would bypass that policy and rely on this
-- file getting its own filter right, forever.

create or replace function public.route_daily_distance(
  days int default 30,
  tz   text default 'UTC'
)
returns table (day date, km double precision)
language sql
stable
security invoker
set search_path = public
as $$
  with fixes as (
    select
      recorded_at,
      lat,
      lng,
      lag(lat)         over (order by recorded_at) as prev_lat,
      lag(lng)         over (order by recorded_at) as prev_lng,
      lag(recorded_at) over (order by recorded_at) as prev_at
    from route_points
    -- RLS already restricts this to the caller; the date bound is what keeps
    -- the scan small, and it matches the window the caller asked for.
    where recorded_at >= (now() - make_interval(days => days))
  ),
  segments as (
    select
      (recorded_at at time zone tz)::date as day,
      extract(epoch from (recorded_at - prev_at)) as seconds,
      case
        when prev_lat is null then 0
        else 2 * 6371.0088 * asin(least(1, sqrt(
               power(sin(radians(lat - prev_lat) / 2), 2)
             + cos(radians(prev_lat)) * cos(radians(lat))
             * power(sin(radians(lng - prev_lng) / 2), 2)
           )))
      end as km
    from fixes
  )
  select
    day,
    coalesce(sum(km) filter (
      where seconds is not null
        and seconds > 0
        and seconds <= 300                      -- SESSION_GAP_MS
        and km / (seconds / 3600.0) <= 200      -- MAX_PLAUSIBLE_KMH
    ), 0)::double precision as km
  from segments
  group by day
  order by day;
$$;

-- `least(1, ...)` above is not decoration: floating point can push the haversine
-- argument a hair over 1 for two fixes at the same spot, and asin() of 1.0000001
-- raises "input is out of range", which would fail the whole query for a driver
-- whose phone reported the identical position twice.

comment on function public.route_daily_distance(int, text) is
  'Per-day driving distance in km for the calling driver, bucketed in the given timezone. Applies the same session-gap and speed filters as LocationService.routeDistanceKm.';

grant execute on function public.route_daily_distance(int, text) to authenticated;
