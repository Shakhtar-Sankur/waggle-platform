-- ============================================================================
-- WAGGLE: PRODUCTION RUN FILE, September 25, 2026 (live maps).
-- Project: ypdaetbeexyepswyhbui (PRODUCTION) ONLY. Paste the whole file into the SQL Editor, Run once.
-- Contains: maps_v1.sql. The shop's live map of its riders, and busy areas for
-- riders. Safe to run again.
-- ============================================================================

-- ============================================================================
-- Waggle maps v1: what the live maps need from the database.
--
-- Run AFTER business_v2.sql and gig_v2.sql. Safe to run again.
--
--   1. business_live_riders(): a shop's live map. Its deliveries in progress,
--      with where the rider is: only riders carrying this shop's orders, only
--      while they carry them, only a recent position.
--   2. demand_near(): "busy areas" for riders. Where pickups happened in the
--      last 14 days, counted in ~1 km squares. Counts only: no shop, no
--      customer, no address.
-- ============================================================================


create or replace function public.business_live_riders(p_business uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id', j.id,
           'status', j.status,
           'dropoff', j.dropoff,
           'drop_lat', d.dropoff_lat,
           'drop_lng', d.dropoff_lng,
           'rider', split_part(coalesce(v.legal_name, p.full_name, ''), ' ', 1),
           'vehicle', v.vehicle,
           'rider_lat', case when wl.updated_at > now() - interval '10 minutes' then wl.lat end,
           'rider_lng', case when wl.updated_at > now() - interval '10 minutes' then wl.lng end,
           'seen_at', wl.updated_at)
           order by j.accepted_at), '[]'::jsonb)
    from public.jobs j
    join public.businesses b on b.id = j.business_id
    left join public.job_details d on d.job_id = j.id
    left join public.worker_verifications v on v.user_id = j.assigned_to
    left join public.profiles p on p.id = j.assigned_to
    left join public.worker_locations wl on wl.user_id = j.assigned_to
   where b.id = p_business
     and b.owner_id = auth.uid()
     and j.status in ('accepted', 'picked_up');
$$;

create or replace function public.demand_near(p_lat double precision, p_lng double precision, p_km double precision default 8)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('lat', c.lat, 'lng', c.lng, 'pickups', c.n) order by c.n desc), '[]'::jsonb)
    from (
      select round(pickup_lat::numeric * 100) / 100 as lat,
             round(pickup_lng::numeric * 100) / 100 as lng,
             count(*) as n
        from public.jobs
       where created_at > now() - interval '14 days'
         and pickup_lat is not null
         and pickup_lat between p_lat - least(p_km, 20) / 111.0 and p_lat + least(p_km, 20) / 111.0
         and public.km_between(p_lat, p_lng, pickup_lat, pickup_lng) <= least(p_km, 20)
       group by 1, 2
      having count(*) >= 2
       order by 3 desc
       limit 40
    ) c
   where public.is_verified_worker(auth.uid());
$$;

revoke all on function public.business_live_riders(uuid) from public, anon;
revoke all on function public.demand_near(double precision, double precision, double precision) from public, anon;
grant execute on function public.business_live_riders(uuid) to authenticated;
grant execute on function public.demand_near(double precision, double precision, double precision) to authenticated;


-- ============================================================================
-- CHECK: run this after the file above. Both rows should say true.
-- ============================================================================
select 'shop live map (business_live_riders)' as item, to_regprocedure('public.business_live_riders(uuid)') is not null as ok
union all select 'rider busy areas (demand_near)', to_regprocedure('public.demand_near(double precision, double precision, double precision)') is not null;
