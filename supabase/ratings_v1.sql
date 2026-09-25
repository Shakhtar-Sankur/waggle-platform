-- ============================================================================
-- Waggle ratings v1: riders are rated after every delivery.
--
-- Run AFTER business_v2.sql, gig_v2.sql and send_v1.sql. Safe to run again.
--
--   * The customer (from their order's tracking link), the sender of a Send
--     (from theirs) and the shop (for its own delivery) each rate the rider
--     once, 1 to 5 stars, within 7 days of delivery. A reason is optional.
--   * Nobody reads the ratings table directly. The rider sees their average,
--     count and star breakdown, never who rated or when. Customers see a
--     rider's average once there are 3 ratings. Gigzen sees every rating of
--     2 stars or less, with the reason, to follow up.
-- ============================================================================


create table if not exists public.rider_ratings (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs(id) on delete cascade,
  rider_id   uuid not null references public.profiles(id) on delete cascade,
  rater      text not null check (rater in ('customer', 'shop', 'sender')),
  stars      integer not null check (stars between 1 and 5),
  reason     text check (reason is null or length(reason) <= 300),
  created_at timestamptz not null default now(),
  unique (job_id, rater)
);
create index if not exists idx_rider_ratings_rider on public.rider_ratings (rider_id, created_at desc);
alter table public.rider_ratings enable row level security;
-- No policies: every read and write goes through the functions below.


-- One rating of one delivery, by one side of it.
create or replace function public._rate_rider(p_job uuid, p_rater text, p_stars integer, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job;
  if j.id is null or j.assigned_to is null then
    return 'not_found';
  end if;
  if j.status <> 'completed' then
    return 'not_yet';
  end if;
  if coalesce(j.delivered_at, j.updated_at) < now() - interval '7 days' then
    return 'too_late';
  end if;
  if p_stars is null or p_stars not between 1 and 5 or length(coalesce(p_reason, '')) > 300 then
    return 'invalid';
  end if;
  insert into public.rider_ratings (job_id, rider_id, rater, stars, reason)
  values (j.id, j.assigned_to, p_rater, p_stars, nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (job_id, rater) do nothing;
  return case when found then 'ok' else 'already' end;
end;
$$;

-- The customer, from their order's tracking link.
create or replace function public.rate_rider_order(p_token text, p_stars integer, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where track_token = p_token and length(p_token) = 36;
  if o.id is null or o.job_id is null then
    return 'not_found';
  end if;
  return public._rate_rider(o.job_id, 'customer', p_stars, p_reason);
end;
$$;

-- The sender of a Send, from their tracking link (not the recipient's).
create or replace function public.rate_rider_send(p_token text, p_stars integer, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sends;
begin
  select * into s from public.sends where token = p_token and length(coalesce(p_token, '')) >= 20;
  if s.id is null or s.job_id is null then
    return 'not_found';
  end if;
  return public._rate_rider(s.job_id, 'sender', p_stars, p_reason);
end;
$$;

-- The shop, for a delivery of its own.
create or replace function public.shop_rate_rider(p_job uuid, p_stars integer, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.jobs j join public.businesses b on b.id = j.business_id
                  where j.id = p_job and b.owner_id = auth.uid()) then
    return 'not_yours';
  end if;
  return public._rate_rider(p_job, 'shop', p_stars, p_reason);
end;
$$;

-- A rider's standing: the last 200 ratings.
create or replace function public._rider_rating(p_rider uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'avg', round(avg(stars)::numeric, 1),
           'count', count(*),
           'stars', jsonb_build_object('5', count(*) filter (where stars = 5), '4', count(*) filter (where stars = 4),
                                       '3', count(*) filter (where stars = 3), '2', count(*) filter (where stars = 2),
                                       '1', count(*) filter (where stars = 1)))
    from (select stars from public.rider_ratings where rider_id = p_rider order by created_at desc limit 200) r;
$$;

-- The rider's own: average, count and breakdown. Never who, never when.
create or replace function public.my_rider_rating()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._rider_rating(auth.uid()) where auth.uid() is not null;
$$;

-- What the customer or sender sees about their rider: the average, once there
-- are 3 ratings, and whether they have rated this delivery yet.
create or replace function public.delivery_rider_rating(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job uuid;
  v_rater text;
  j public.jobs;
  r jsonb;
begin
  select job_id, 'customer' into v_job, v_rater from public.orders where track_token = p_token and length(p_token) = 36;
  if v_job is null then
    select job_id, 'sender' into v_job, v_rater from public.sends where token = p_token and length(coalesce(p_token, '')) >= 20;
  end if;
  if v_job is null then
    return null;
  end if;
  select * into j from public.jobs where id = v_job;
  if j.assigned_to is null then
    return null;
  end if;
  r := public._rider_rating(j.assigned_to);
  return jsonb_build_object(
    'avg', case when (r ->> 'count')::int >= 3 then r -> 'avg' end,
    'count', (r ->> 'count')::int,
    'can_rate', j.status = 'completed' and coalesce(j.delivered_at, j.updated_at) >= now() - interval '7 days',
    'rated', (select stars from public.rider_ratings where job_id = v_job and rater = v_rater));
end;
$$;

-- The shop's view of one delivery: whether it has rated the rider.
create or replace function public.shop_job_rating(p_job uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select r.stars from public.rider_ratings r
    join public.jobs j on j.id = r.job_id
    join public.businesses b on b.id = j.business_id
   where r.job_id = p_job and r.rater = 'shop' and b.owner_id = auth.uid();
$$;

-- Gigzen: every rider's standing, and every low rating of the last 30 days.
create or replace function public.admin_rider_ratings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'riders', coalesce((
      select jsonb_agg(jsonb_build_object('rider_id', x.rider_id, 'name', p.full_name, 'avg', x.avg, 'count', x.n, 'low', x.low) order by x.avg, x.n desc)
        from (select rider_id, round(avg(stars)::numeric, 1) as avg, count(*) as n,
                     count(*) filter (where stars <= 2 and created_at > now() - interval '30 days') as low
                from public.rider_ratings group by rider_id) x
        join public.profiles p on p.id = x.rider_id), '[]'::jsonb),
    'low', coalesce((
      select jsonb_agg(jsonb_build_object('rider_id', r.rider_id, 'name', p.full_name, 'stars', r.stars, 'rater', r.rater,
                                          'reason', r.reason, 'job', j.title, 'at', r.created_at) order by r.created_at desc)
        from public.rider_ratings r
        join public.profiles p on p.id = r.rider_id
        join public.jobs j on j.id = r.job_id
       where r.stars <= 2 and r.created_at > now() - interval '30 days'), '[]'::jsonb));
end;
$$;

revoke all on table public.rider_ratings from anon, authenticated;
revoke all on function public._rate_rider(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public._rider_rating(uuid) from public, anon, authenticated;
revoke all on function public.shop_rate_rider(uuid, integer, text) from public, anon;
revoke all on function public.my_rider_rating() from public, anon;
revoke all on function public.shop_job_rating(uuid) from public, anon;
revoke all on function public.admin_rider_ratings() from public, anon;
-- Customers and senders rate from their link, signed in or not: the token is the key.
grant execute on function public.rate_rider_order(text, integer, text) to anon, authenticated;
grant execute on function public.rate_rider_send(text, integer, text) to anon, authenticated;
grant execute on function public.delivery_rider_rating(text) to anon, authenticated;
grant execute on function public.shop_rate_rider(uuid, integer, text) to authenticated;
grant execute on function public.my_rider_rating() to authenticated;
grant execute on function public.shop_job_rating(uuid) to authenticated;
grant execute on function public.admin_rider_ratings() to authenticated;
