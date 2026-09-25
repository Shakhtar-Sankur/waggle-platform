-- ============================================================================
-- WAGGLE: TEST RUN FILE, September 25, 2026 (the new Waggle Gig).
-- Project: jqepegeifmnfofeyebrz (TEST) ONLY.
-- Paste this whole file into the Supabase SQL Editor and press Run, once.
-- Contains: gig_v2.sql. Adds hours online, rider earnings and history, the
-- Rider hub (notices and zone alerts), help requests, the shop's phone for the
-- rider on a job, and honest location sharing. Safe to run again.
-- Run it BEFORE installing Waggle Gig 1.6.0 / Waggle Business 1.1.2.
-- ============================================================================

-- ============================================================================
-- Waggle Gig v2: the rider app's own backend.
--
-- Run AFTER business.sql and business_v2.sql. Safe to run again.
--
--   1. Shifts: every stretch a rider is online, so hours and earnings per hour
--      are measured, not guessed.
--   2. Earnings and history: real money from Waggle jobs, by day, and every
--      delivery with its times, shop and payment.
--   3. Rider hub: announcements and zone alerts from Gigzen, near the rider or
--      for everyone.
--   4. Help: a rider (or anyone signed in) opens a ticket, Gigzen answers.
--   5. Location sharing kept honest: a rider who hides their position from
--      friends still shows it to the customer of the job they are carrying.
-- ============================================================================


-- ============================================================================ 1. shifts

create table if not exists public.rider_shifts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at     timestamptz
);
create index if not exists idx_rider_shifts_user on public.rider_shifts (user_id, started_at desc);
create unique index if not exists idx_rider_shifts_open on public.rider_shifts (user_id) where ended_at is null;
alter table public.rider_shifts enable row level security;
drop policy if exists "shifts own read" on public.rider_shifts;
create policy "shifts own read" on public.rider_shifts for select to authenticated using (user_id = auth.uid());

-- Written only by the availability switch. A phone that dies while online stops
-- sending, so a shift is counted to the last time it was seen, not to "now".
create or replace function public.track_rider_shift()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.online and (tg_op = 'INSERT' or not old.online) then
    update public.rider_shifts set ended_at = last_seen_at where user_id = new.user_id and ended_at is null;
    insert into public.rider_shifts (user_id, started_at, last_seen_at) values (new.user_id, now(), now());
  elsif new.online then
    -- Silent for more than 10 minutes: that shift ended when it went quiet, and this is a new one.
    update public.rider_shifts set ended_at = last_seen_at
     where user_id = new.user_id and ended_at is null and last_seen_at < now() - interval '10 minutes';
    update public.rider_shifts set last_seen_at = now() where user_id = new.user_id and ended_at is null;
    if not found then
      insert into public.rider_shifts (user_id) values (new.user_id);
    end if;
  elsif tg_op = 'UPDATE' and old.online and not new.online then
    update public.rider_shifts set ended_at = now(), last_seen_at = now() where user_id = new.user_id and ended_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_track_rider_shift on public.worker_availability;
create trigger trg_track_rider_shift
  after insert or update on public.worker_availability
  for each row execute function public.track_rider_shift();
revoke all on function public.track_rider_shift() from public, anon, authenticated;

-- Minutes online between two moments, for one rider.
create or replace function public._online_minutes(p_user uuid, p_from timestamptz, p_to timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(round(sum(extract(epoch from (least(coalesce(s.ended_at, s.last_seen_at), p_to) - greatest(s.started_at, p_from))) / 60)::numeric, 0), 0)
    from public.rider_shifts s
   where s.user_id = p_user
     and s.started_at < p_to
     and coalesce(s.ended_at, s.last_seen_at) > p_from;
$$;
revoke all on function public._online_minutes(uuid, timestamptz, timestamptz) from public, anon, authenticated;


-- ============================================================================ 2. earnings and history

-- The signed-in rider's money from Waggle jobs, day by day, in India time.
-- p_from and p_to are calendar days, both included.
create or replace function public.my_earnings(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  t0     timestamptz := (p_from::timestamp at time zone 'Asia/Kolkata');
  t1     timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Kolkata');
  v_days jsonb;
  v_tot  jsonb;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 92 then
    raise exception 'Choose up to three months' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'day', d.day, 'deliveries', coalesce(j.n, 0), 'fare', coalesce(j.fare, 0), 'km', coalesce(j.km, 0),
           'online_minutes', public._online_minutes(me, d.day::timestamp at time zone 'Asia/Kolkata', (d.day + 1)::timestamp at time zone 'Asia/Kolkata'))
           order by d.day), '[]'::jsonb)
    into v_days
    from (select generate_series(p_from, p_to, interval '1 day')::date as day) d
    left join (
      select (delivered_at at time zone 'Asia/Kolkata')::date as day, count(*) as n, sum(payout) as fare, round(sum(distance_km), 1) as km
        from public.jobs
       where assigned_to = me and status = 'completed' and delivered_at >= t0 and delivered_at < t1
       group by 1
    ) j on j.day = d.day;

  select jsonb_build_object(
           'deliveries', count(*),
           'fare', coalesce(sum(payout), 0),
           'km', coalesce(round(sum(distance_km), 1), 0),
           'shop_paid', coalesce(sum(payout) filter (where business_id is not null and rider_paid_at is not null and rider_pay_disputed_at is null), 0),
           'shop_waiting', coalesce(sum(payout) filter (where business_id is not null and rider_paid_at is null), 0),
           'shop_disputed', coalesce(sum(payout) filter (where rider_pay_disputed_at is not null), 0),
           'online_minutes', public._online_minutes(me, t0, least(t1, now())))
    into v_tot
    from public.jobs
   where assigned_to = me and status = 'completed' and delivered_at >= t0 and delivered_at < t1;

  return jsonb_build_object('from', p_from, 'to', p_to, 'totals', v_tot, 'days', v_days);
end;
$$;

-- Every delivery the rider made, newest first, with the shop and the times.
create or replace function public.my_job_history(p_before timestamptz default null, p_limit int default 30)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x.delivered_at desc), '[]'::jsonb)
    from (
      select j.id, j.pickup, j.dropoff, j.distance_km, j.payout, j.source, j.external_ref,
             j.created_at, j.accepted_at, j.picked_up_at, j.delivered_at,
             j.rider_paid_at, j.rider_pay_utr, j.rider_pay_disputed_at,
             b.name as shop_name, b.kind as shop_kind, b.phone as shop_phone
        from public.jobs j
        left join public.businesses b on b.id = j.business_id
       where j.assigned_to = auth.uid()
         and j.status = 'completed'
         and j.delivered_at < coalesce(p_before, now() + interval '1 minute')
       order by j.delivered_at desc
       limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) x;
$$;

revoke all on function public.my_earnings(date, date) from public, anon;
revoke all on function public.my_job_history(timestamptz, int) from public, anon;
grant execute on function public.my_earnings(date, date) to authenticated;
grant execute on function public.my_job_history(timestamptz, int) to authenticated;


-- ============================================================================ 3. rider hub

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('news', 'zone_alert', 'safety')),
  title      text not null check (char_length(title) between 3 and 90),
  body       text not null check (char_length(body) between 3 and 800),
  lat        double precision,
  lng        double precision,
  radius_km  numeric check (radius_km is null or radius_km between 0.5 and 100),
  area       text check (area is null or char_length(area) <= 60),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((lat is null) = (lng is null) and (lat is null) = (radius_km is null))
);
create index if not exists idx_announcements_live on public.announcements (starts_at desc);
alter table public.announcements enable row level security;
-- Read through rider_hub() only; no direct access.
drop policy if exists "announcements admins read" on public.announcements;
create policy "announcements admins read" on public.announcements for select to authenticated using (public.is_admin());

-- What a rider sees: live notices for everyone, and zone notices that cover where they are.
create or replace function public.rider_hub(p_lat double precision default null, p_lng double precision default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body, 'area', a.area,
           'starts_at', a.starts_at, 'ends_at', a.ends_at, 'radius_km', a.radius_km,
           'km_away', case when a.lat is not null and p_lat is not null then round(public.km_between(p_lat, p_lng, a.lat, a.lng)::numeric, 1) end)
           order by (a.kind = 'zone_alert') desc, a.starts_at desc), '[]'::jsonb)
    from public.announcements a
   where auth.uid() is not null
     and a.starts_at <= now()
     and (a.ends_at is null or a.ends_at > now())
     and a.starts_at > now() - interval '60 days'
     and (a.lat is null or (p_lat is not null and public.km_between(p_lat, p_lng, a.lat, a.lng) <= a.radius_km + 2));
$$;

create or replace function public.admin_post_announcement(
  p_kind text, p_title text, p_body text,
  p_lat double precision default null, p_lng double precision default null, p_radius_km numeric default null,
  p_area text default null, p_hours int default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  insert into public.announcements (kind, title, body, lat, lng, radius_km, area, ends_at, created_by)
  values (p_kind, trim(p_title), trim(p_body), p_lat, p_lng, p_radius_km, nullif(trim(coalesce(p_area, '')), ''),
          case when p_hours is not null then now() + make_interval(hours => least(greatest(p_hours, 1), 24 * 30)) end, auth.uid())
  returning id into v_id;

  -- Riders it concerns hear about it at once: everyone verified for a notice to
  -- all, the riders online near the zone for a zone alert.
  insert into public.notifications (id, user_id, title, description, kind, read, created_at)
  select gen_random_uuid()::text, v.user_id,
         case p_kind when 'zone_alert' then '⚠ ' when 'safety' then '🛟 ' else '' end || trim(p_title),
         left(trim(p_body), 160), 'system', false, now()
    from public.worker_verifications v
    left join public.worker_availability a on a.user_id = v.user_id
   where v.status = 'verified'
     and (p_lat is null or (a.online and a.lat is not null and a.updated_at > now() - interval '30 minutes'
                            and public.km_between(a.lat, a.lng, p_lat, p_lng) <= p_radius_km + 2))
   limit 5000;
  return v_id;
end;
$$;

create or replace function public.admin_end_announcement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.announcements set ends_at = now() where id = p_id and (ends_at is null or ends_at > now());
end;
$$;

revoke all on function public.rider_hub(double precision, double precision) from public, anon;
revoke all on function public.admin_post_announcement(text, text, text, double precision, double precision, numeric, text, int) from public, anon;
revoke all on function public.admin_end_announcement(uuid) from public, anon;
grant execute on function public.rider_hub(double precision, double precision) to authenticated;
grant execute on function public.admin_post_announcement(text, text, text, double precision, double precision, numeric, text, int) to authenticated;
grant execute on function public.admin_end_announcement(uuid) to authenticated;


-- ============================================================================ 4. help

create table if not exists public.support_tickets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  app        text not null default 'gig' check (app in ('gig', 'business', 'waggle')),
  topic      text not null check (topic in ('payment', 'delivery', 'account', 'app', 'safety', 'other')),
  job_id     uuid references public.jobs(id) on delete set null,
  message    text not null check (char_length(message) between 10 and 1000),
  status     text not null default 'open' check (status in ('open', 'answered', 'closed')),
  reply      text,
  replied_at timestamptz,
  replied_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_support_tickets_user on public.support_tickets (user_id, created_at desc);
create index if not exists idx_support_tickets_open on public.support_tickets (created_at) where status = 'open';
alter table public.support_tickets enable row level security;
drop policy if exists "tickets own read" on public.support_tickets;
create policy "tickets own read" on public.support_tickets for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create or replace function public.open_ticket(p_topic text, p_message text, p_job uuid default null, p_app text default 'gig')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if (select count(*) from public.support_tickets where user_id = auth.uid() and status = 'open') >= 5 then
    raise exception 'You have 5 open requests. Gigzen answers those first.' using errcode = '22023';
  end if;
  -- A delivery can be named only by the rider who carried it or the shop that sent it.
  if p_job is not null and not exists (
       select 1 from public.jobs j left join public.businesses b on b.id = j.business_id
        where j.id = p_job and (j.assigned_to = auth.uid() or b.owner_id = auth.uid())) then
    raise exception 'No such delivery' using errcode = '42501';
  end if;
  insert into public.support_tickets (user_id, app, topic, job_id, message)
  values (auth.uid(), coalesce(p_app, 'gig'), p_topic, p_job, trim(p_message))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_ticket_queue()
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
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'app', t.app, 'topic', t.topic, 'message', t.message, 'status', t.status,
             'reply', t.reply, 'created_at', t.created_at, 'job_id', t.job_id,
             'name', p.full_name, 'phone', p.phone,
             'job', case when j.id is not null then jsonb_build_object('dropoff', j.dropoff, 'payout', j.payout, 'status', j.status,
                      'delivered_at', j.delivered_at, 'rider_paid_at', j.rider_paid_at, 'rider_pay_utr', j.rider_pay_utr,
                      'rider_pay_disputed_at', j.rider_pay_disputed_at, 'shop', b.name) end)
             order by (t.status = 'open') desc, t.created_at), '[]'::jsonb)
      from public.support_tickets t
      join public.profiles p on p.id = t.user_id
      left join public.jobs j on j.id = t.job_id
      left join public.businesses b on b.id = j.business_id
     where t.status = 'open' or t.created_at > now() - interval '14 days'
  );
end;
$$;

create or replace function public.admin_reply_ticket(p_id uuid, p_reply text, p_close boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.support_tickets;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_reply, ''))) < 2 then
    raise exception 'Write a reply' using errcode = '22023';
  end if;
  update public.support_tickets
     set reply = trim(p_reply), replied_at = now(), replied_by = auth.uid(),
         status = case when p_close then 'closed' else 'answered' end
   where id = p_id
  returning * into t;
  if t.id is null then
    raise exception 'No such request' using errcode = '22023';
  end if;
  insert into public.notifications (id, user_id, title, description, kind, read, created_at)
  values (gen_random_uuid()::text, t.user_id, 'Gigzen answered your request', left(trim(p_reply), 160), 'system', false, now());
end;
$$;

revoke all on function public.open_ticket(text, text, uuid, text) from public, anon;
revoke all on function public.admin_ticket_queue() from public, anon;
revoke all on function public.admin_reply_ticket(uuid, text, boolean) from public, anon;
grant execute on function public.open_ticket(text, text, uuid, text) to authenticated;
grant execute on function public.admin_ticket_queue() to authenticated;
grant execute on function public.admin_reply_ticket(uuid, text, boolean) to authenticated;


-- ============================================================================ 5. location sharing

-- The app used to delete the rider's location row to hide it from friends. The
-- customer's tracking map reads that same row, so hiding from friends also hid
-- the rider from the person waiting for the order. Now the row stays and this
-- flag decides who else sees it: friends never, when it is off; the customer
-- of the job being carried, always (track_order reads it directly).
create or replace function public.set_location_sharing(p_share boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  update public.worker_locations set share_stats = coalesce(p_share, true) where user_id = auth.uid();
end;
$$;
revoke all on function public.set_location_sharing(boolean) from public, anon;
grant execute on function public.set_location_sharing(boolean) to authenticated;


-- ============================================================================ 6. the shop, for the rider on its job

-- While a rider holds a job, the shop's name, phone and address, so they can
-- call ahead or find the counter. Not the customer's number: calls to the
-- customer need a masked line, which needs a telephony provider.
create or replace function public.job_shop_contact(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', b.name, 'phone', b.phone, 'address', b.address, 'kind', b.kind)
    from public.jobs j
    join public.businesses b on b.id = j.business_id
   where j.id = p_job and j.assigned_to = auth.uid() and j.status in ('accepted', 'picked_up');
$$;
revoke all on function public.job_shop_contact(uuid) from public, anon;
grant execute on function public.job_shop_contact(uuid) to authenticated;


-- ============================================================================
-- CHECK: run this after the file above. All 7 rows should say true.
-- ============================================================================
select 'rider shifts (hours online)' as item, to_regclass('public.rider_shifts') is not null as ok
union all select 'shift trigger on going online', exists (select 1 from pg_trigger where tgname = 'trg_track_rider_shift')
union all select 'earnings and history', to_regprocedure('public.my_earnings(date, date)') is not null and to_regprocedure('public.my_job_history(timestamptz, integer)') is not null
union all select 'rider hub notices', to_regclass('public.announcements') is not null and to_regprocedure('public.rider_hub(double precision, double precision)') is not null
union all select 'help requests', to_regclass('public.support_tickets') is not null and to_regprocedure('public.open_ticket(text, text, uuid, text)') is not null
union all select 'shop contact for the rider on a job', to_regprocedure('public.job_shop_contact(uuid)') is not null
union all select 'visitors cannot read help requests', not has_table_privilege('anon', 'public.support_tickets', 'select')
   or not exists (select 1 from pg_policies where tablename = 'support_tickets' and 'anon' = any(roles));
