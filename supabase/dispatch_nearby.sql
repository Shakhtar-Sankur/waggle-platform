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
