-- ============================================================================
-- Waggle Send v1: a customer sends a parcel across town with a Waggle rider.
--
-- Run AFTER business_v2.sql, gig_v2.sql and maps_v1.sql. Safe to run again.
--
-- How it works, and why:
--   * The sender books in the Waggle app: pickup and drop pins, both people's
--     names and phones, what it is and how big (bike-size only, up to 10 kg).
--   * The price is the rider's fare (the same road-distance formula as shop
--     deliveries), paid to the rider directly by UPI or cash at pickup, plus a
--     Waggle fee of Rs 15 that is recorded on every Send but WAIVED ("launch
--     offer") until Gigzen has its own bank account and UPI. One admin switch
--     turns it on; then the sender pays it to Gigzen's UPI and gives the UTR.
--   * A Send becomes an ordinary rider job (source 'send', no business), so the
--     riders' app, dispatch, codes, navigation and earnings all work unchanged.
--   * The rider must photograph the parcel before the pickup code is accepted,
--     and sees both phone numbers only while carrying it.
--   * The sender's link shows both codes; the recipient's link (shared by the
--     sender) shows only the delivery code.
-- ============================================================================


-- ============================================================================ jobs can come from a Send

alter table public.jobs drop constraint if exists jobs_source_check;
alter table public.jobs add constraint jobs_source_check check (source in ('app', 'api', 'order', 'send'));

-- New-job alerts skipped jobs with no business; a Send has none.
create or replace function public.notify_job_nearby()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'open' or new.pickup_lat is null or (new.business_id is null and new.source <> 'send') then
    return new;
  end if;
  insert into public.notifications (id, user_id, title, description, kind, read, created_at)
  select gen_random_uuid()::text, a.user_id,
         case when new.source = 'send' then 'New parcel near you · ₹' else 'New job near you · ₹' end || trim(to_char(new.payout, 'FM999990')),
         left(split_part(coalesce(new.pickup, ''), ',', 1) || ' → ' || new.dropoff || ' · ' || new.distance_km || ' km', 120),
         'job', false, now()
    from public.worker_availability a
   where a.online
     and a.updated_at > now() - interval '20 minutes'
     and a.lat is not null and a.lng is not null
     and public.km_between(a.lat, a.lng, new.pickup_lat, new.pickup_lng) <= 8
     and a.user_id is distinct from new.created_by
     and public.is_verified_worker(a.user_id)
   limit 50;
  return new;
end;
$$;


-- ============================================================================ the fee switch

alter table public.company_settings add column if not exists send_fee_paise integer not null default 1500
  check (send_fee_paise between 0 and 100000);
alter table public.company_settings add column if not exists send_fee_live boolean not null default false;

create or replace function public.admin_set_send_fee(p_live boolean, p_paise integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cs public.company_settings;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select * into cs from public.company_settings where id;
  if p_live and cs.upi_id is null then
    raise exception 'Add Gigzen''s UPI ID first: customers need somewhere to pay the fee' using errcode = '22023';
  end if;
  update public.company_settings
     set send_fee_live = coalesce(p_live, send_fee_live),
         send_fee_paise = coalesce(p_paise, send_fee_paise)
   where id
  returning * into cs;
  return jsonb_build_object('live', cs.send_fee_live, 'fee_paise', cs.send_fee_paise);
end;
$$;


-- ============================================================================ sends

create table if not exists public.sends (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  token             text not null unique,
  share_token       text not null unique,
  customer_id       uuid not null references public.profiles(id) on delete cascade,
  pickup_name       text not null check (char_length(pickup_name) between 2 and 60),
  pickup_phone      text not null check (pickup_phone ~ '^\+91[6-9][0-9]{9}$'),
  pickup_area       text not null check (char_length(pickup_area) between 2 and 60),
  pickup_address    text not null check (char_length(pickup_address) between 5 and 200),
  pickup_lat        double precision not null check (pickup_lat between -90 and 90),
  pickup_lng        double precision not null check (pickup_lng between -180 and 180),
  drop_name         text not null check (char_length(drop_name) between 2 and 60),
  drop_phone        text not null check (drop_phone ~ '^\+91[6-9][0-9]{9}$'),
  drop_area         text not null check (char_length(drop_area) between 2 and 60),
  drop_address      text not null check (char_length(drop_address) between 5 and 200),
  drop_lat          double precision not null check (drop_lat between -90 and 90),
  drop_lng          double precision not null check (drop_lng between -180 and 180),
  kind              text not null check (kind in ('documents', 'food', 'clothes', 'electronics', 'keys', 'medicine', 'other')),
  size              text not null check (size in ('envelope', 'small', 'medium')),
  fragile           boolean not null default false,
  description       text check (description is null or char_length(description) <= 200),
  rider_note        text check (rider_note is null or char_length(rider_note) <= 200),
  distance_km       numeric not null,
  fare              numeric not null,
  fee_paise         integer not null default 0,
  fee_waived        boolean not null default true,
  fee_utr           text unique check (fee_utr is null or fee_utr ~ '^[0-9A-Z]{10,22}$'),
  status            text not null default 'booked' check (status in ('booked', 'assigned', 'picked_up', 'delivered', 'cancelled')),
  scheduled_for     timestamptz,
  job_id            uuid unique references public.jobs(id) on delete set null,
  parcel_photo_path text,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  assigned_at       timestamptz,
  picked_up_at      timestamptz,
  delivered_at      timestamptz,
  cancelled_at      timestamptz
);
create index if not exists idx_sends_customer on public.sends (customer_id, created_at desc);
create index if not exists idx_sends_due on public.sends (scheduled_for) where status = 'booked' and job_id is null;
alter table public.sends enable row level security;
drop policy if exists "sends own read" on public.sends;
create policy "sends own read" on public.sends for select to authenticated using (customer_id = auth.uid());

-- An Indian mobile number, as +91XXXXXXXXXX, or null if it is not one.
create or replace function public._in_mobile(p text)
returns text
language sql
immutable
as $$
  select case when d ~ '^[6-9][0-9]{9}$' then '+91' || d end
    from (select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10) as d,
                 regexp_replace(coalesce(p, ''), '\D', '', 'g') as full_digits) x
   where length(full_digits) in (10, 12) and (length(full_digits) = 10 or left(full_digits, 2) = '91');
$$;

-- The price of a Send: the rider's fare by road distance, and the Waggle fee.
create or replace function public.send_quote(p_pick_lat double precision, p_pick_lng double precision,
                                             p_drop_lat double precision, p_drop_lng double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  straight double precision;
  road_km  numeric;
  fare     numeric;
  cs       public.company_settings;
begin
  if p_pick_lat is null or p_drop_lat is null then
    raise exception 'Pin both places on the map' using errcode = '22023';
  end if;
  straight := public.km_between(p_pick_lat, p_pick_lng, p_drop_lat, p_drop_lng);
  road_km := round((straight * 1.3)::numeric, 1);
  fare := public.delivery_fare(road_km);
  select * into cs from public.company_settings where id;
  return jsonb_build_object(
    'km', road_km, 'fare', fare,
    'fee_paise', coalesce(cs.send_fee_paise, 1500), 'fee_live', coalesce(cs.send_fee_live, false),
    'fee_upi', case when cs.send_fee_live then cs.upi_id end,
    'total', fare + case when coalesce(cs.send_fee_live, false) then coalesce(cs.send_fee_paise, 1500) / 100.0 else 0 end,
    'too_far', straight > 20, 'too_close', straight < 0.1);
end;
$$;

-- A Send becomes a rider job. Called at booking, or when a scheduled one is due.
create or replace function public._dispatch_send(p_send uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s     public.sends;
  posted public.jobs;
  what  text;
begin
  select * into s from public.sends where id = p_send for update;
  if s.id is null or s.job_id is not null or s.status <> 'booked' then
    return s.job_id;
  end if;
  what := initcap(replace(s.kind, '_', ' ')) || ' · ' ||
          case s.size when 'envelope' then 'Envelope' when 'small' then 'Small box' else 'Medium box' end ||
          case when s.fragile then ' · Fragile' else '' end;
  insert into public.jobs (title, pickup, dropoff, distance_km, payout, app, eta_minutes, status,
                           created_by, business_id, fee_paise, note, pickup_lat, pickup_lng, source, external_ref)
  values ('Parcel · ' || what,
          s.pickup_area || ', ' || s.pickup_address,
          s.drop_area,
          s.distance_km,
          s.fare,
          'waggle',
          greatest(5, round(s.distance_km * 3)::int + 5),
          'open',
          s.customer_id,
          null,
          0,
          left(what || coalesce(' · ' || s.description, ''), 300),
          s.pickup_lat,
          s.pickup_lng,
          'send',
          s.code)
  returning * into posted;
  insert into public.job_details (job_id, dropoff_address, dropoff_lat, dropoff_lng, customer_note)
  values (posted.id, s.drop_address, s.drop_lat, s.drop_lng, s.rider_note);
  insert into public.job_codes (job_id, pickup_code, delivery_code)
  values (posted.id, lpad((floor(random() * 10000))::int::text, 4, '0'), lpad((floor(random() * 10000))::int::text, 4, '0'));
  update public.sends set job_id = posted.id where id = s.id;
  return posted.id;
end;
$$;
revoke all on function public._dispatch_send(uuid) from public, anon, authenticated;

create or replace function public.book_send(
  p_pick_name text, p_pick_phone text, p_pick_area text, p_pick_address text, p_pick_lat double precision, p_pick_lng double precision,
  p_drop_name text, p_drop_phone text, p_drop_area text, p_drop_address text, p_drop_lat double precision, p_drop_lng double precision,
  p_kind text, p_size text, p_fragile boolean, p_description text, p_rider_note text,
  p_banned_ack boolean, p_scheduled_for timestamptz default null, p_fee_utr text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q        jsonb;
  cs       public.company_settings;
  s        public.sends;
  pick_ph  text := public._in_mobile(p_pick_phone);
  drop_ph  text := public._in_mobile(p_drop_phone);
  utr      text := nullif(upper(regexp_replace(coalesce(p_fee_utr, ''), '\s', '', 'g')), '');
  v_code   text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to send a parcel' using errcode = '42501';
  end if;
  if not coalesce(p_banned_ack, false) then
    raise exception 'Confirm the parcel holds nothing from the banned list' using errcode = '22023';
  end if;
  if pick_ph is null or drop_ph is null then
    raise exception 'Enter 10-digit Indian mobile numbers for both people' using errcode = '22023';
  end if;
  if p_size not in ('envelope', 'small', 'medium') then
    raise exception 'Waggle Send carries bike-size parcels only: up to a medium box, 10 kg' using errcode = '22023';
  end if;
  if p_scheduled_for is not null and (p_scheduled_for < now() + interval '25 minutes' or p_scheduled_for > now() + interval '7 days') then
    raise exception 'Schedule a Send between 30 minutes and 7 days ahead' using errcode = '22023';
  end if;
  if (select count(*) from public.sends where customer_id = auth.uid() and status in ('booked', 'assigned', 'picked_up')) >= 3 then
    raise exception 'You have 3 Sends on the way. Book another when one is delivered.' using errcode = '22023';
  end if;
  if (select count(*) from public.sends where customer_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'That is the most Sends for one day' using errcode = '22023';
  end if;

  q := public.send_quote(p_pick_lat, p_pick_lng, p_drop_lat, p_drop_lng);
  if (q ->> 'too_far')::boolean then
    raise exception 'Waggle Send goes up to 20 km' using errcode = '22023';
  end if;
  if (q ->> 'too_close')::boolean then
    raise exception 'The pickup and drop are the same place' using errcode = '22023';
  end if;

  select * into cs from public.company_settings where id;
  if cs.send_fee_live then
    if utr is null or utr !~ '^[0-9A-Z]{10,22}$' then
      raise exception 'Pay the Rs % Waggle fee to % and enter the UTR', cs.send_fee_paise / 100, cs.upi_id using errcode = '22023';
    end if;
    if exists (select 1 from public.sends where fee_utr = utr) then
      raise exception 'This UTR is already used' using errcode = '23505';
    end if;
  end if;

  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.sends where code = v_code);
  end loop;

  insert into public.sends (code, token, share_token, customer_id,
      pickup_name, pickup_phone, pickup_area, pickup_address, pickup_lat, pickup_lng,
      drop_name, drop_phone, drop_area, drop_address, drop_lat, drop_lng,
      kind, size, fragile, description, rider_note, distance_km, fare,
      fee_paise, fee_waived, fee_utr, scheduled_for)
  values (v_code, replace(gen_random_uuid()::text, '-', ''), replace(gen_random_uuid()::text, '-', ''), auth.uid(),
      btrim(p_pick_name), pick_ph, btrim(p_pick_area), btrim(p_pick_address), p_pick_lat, p_pick_lng,
      btrim(p_drop_name), drop_ph, btrim(p_drop_area), btrim(p_drop_address), p_drop_lat, p_drop_lng,
      p_kind, p_size, coalesce(p_fragile, false), nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_rider_note, '')), ''),
      (q ->> 'km')::numeric, (q ->> 'fare')::numeric,
      coalesce(cs.send_fee_paise, 1500), not coalesce(cs.send_fee_live, false), case when cs.send_fee_live then utr end,
      p_scheduled_for)
  returning * into s;

  if s.scheduled_for is null then
    perform public._dispatch_send(s.id);
  end if;
  return jsonb_build_object('code', s.code, 'token', s.token, 'share_token', s.share_token,
                            'fare', s.fare, 'fee_paise', s.fee_paise, 'fee_waived', s.fee_waived, 'km', s.distance_km);
end;
$$;

-- Scheduled Sends go out to riders 15 minutes before their time.
create or replace function public._dispatch_due_sends()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from public.sends where status = 'booked' and job_id is null
             and scheduled_for is not null and scheduled_for <= now() + interval '15 minutes' loop
    perform public._dispatch_send(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public._dispatch_due_sends() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('waggle-send-dispatch');
  exception when others then null;
  end;
  perform cron.schedule('waggle-send-dispatch', '* * * * *', $job$ select public._dispatch_due_sends(); $job$);
exception when others then
  raise notice 'pg_cron unavailable (%). Scheduled Sends wait until it is on.', sqlerrm;
end $$;

-- The job's progress, carried onto the Send, and the sender told.
create or replace function public.sync_send_with_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sends;
  rider text;
begin
  select * into s from public.sends where job_id = new.id;
  if s.id is null or s.status in ('delivered', 'cancelled') then
    return null;
  end if;
  select split_part(coalesce(v.legal_name, p.full_name, 'Your rider'), ' ', 1) into rider
    from public.profiles p left join public.worker_verifications v on v.user_id = p.id where p.id = new.assigned_to;

  if new.status = 'accepted' and old.status = 'open' then
    update public.sends set status = 'assigned', assigned_at = now() where id = s.id;
    insert into public.notifications (id, user_id, title, description, kind, read, created_at)
    values (gen_random_uuid()::text, s.customer_id, coalesce(rider, 'A rider') || ' is coming for your parcel',
            'Send ' || s.code || ': pay the rider ₹' || trim(to_char(s.fare, 'FM999990')) || ' at pickup.', 'job', false, now());
  elsif new.status = 'open' and old.status = 'accepted' then
    update public.sends set status = 'booked', assigned_at = null where id = s.id;
  elsif new.status = 'picked_up' and old.status = 'accepted' then
    update public.sends set status = 'picked_up', picked_up_at = now() where id = s.id;
    insert into public.notifications (id, user_id, title, description, kind, read, created_at)
    values (gen_random_uuid()::text, s.customer_id, 'Your parcel is on its way', 'Send ' || s.code || ' to ' || s.drop_name || '.', 'job', false, now());
  elsif new.status = 'completed' and old.status is distinct from 'completed' then
    update public.sends set status = 'delivered', delivered_at = coalesce(new.delivered_at, now()) where id = s.id;
    insert into public.notifications (id, user_id, title, description, kind, read, created_at)
    values (gen_random_uuid()::text, s.customer_id, 'Delivered to ' || s.drop_name, 'Send ' || s.code || ' is done.', 'job', false, now());
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.sends set status = 'cancelled', cancelled_at = now(), cancel_reason = coalesce(cancel_reason, 'Cancelled') where id = s.id;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_sync_send_with_job on public.jobs;
create trigger trg_sync_send_with_job
  after update of status on public.jobs
  for each row when (new.source = 'send')
  execute function public.sync_send_with_job();
revoke all on function public.sync_send_with_job() from public, anon, authenticated;

-- No pickup without a photo of the parcel: the rider's proof of what they took.
create or replace function public.guard_send_pickup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source = 'send' and new.status = 'picked_up' and old.status = 'accepted'
     and not exists (select 1 from public.sends where job_id = new.id and parcel_photo_path is not null) then
    raise exception 'Take a photo of the parcel before pickup' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_send_pickup on public.jobs;
create trigger trg_guard_send_pickup
  before update of status on public.jobs
  for each row when (new.source = 'send')
  execute function public.guard_send_pickup();
revoke all on function public.guard_send_pickup() from public, anon, authenticated;

-- Tracking, for the sender (their token) or the recipient (the shared token).
create or replace function public.track_send(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s        public.sends;
  sender   boolean;
  j        public.jobs;
  c        public.job_codes;
  v        public.worker_verifications;
  wl       public.worker_locations;
begin
  select * into s from public.sends where token = p_token or share_token = p_token;
  if s.id is null or length(coalesce(p_token, '')) < 20 then
    return null;
  end if;
  sender := s.token = p_token;
  select * into j from public.jobs where id = s.job_id;
  select * into c from public.job_codes where job_id = s.job_id;
  select * into v from public.worker_verifications where user_id = j.assigned_to;
  select * into wl from public.worker_locations where user_id = j.assigned_to;
  return jsonb_build_object(
    'code', s.code, 'status', s.status, 'viewer', case when sender then 'sender' else 'recipient' end,
    'kind', s.kind, 'size', s.size, 'fragile', s.fragile,
    'pickup', jsonb_build_object('name', s.pickup_name, 'area', s.pickup_area, 'lat', s.pickup_lat, 'lng', s.pickup_lng),
    'drop', jsonb_build_object('name', s.drop_name, 'area', s.drop_area, 'lat', s.drop_lat, 'lng', s.drop_lng),
    'km', s.distance_km, 'scheduled_for', s.scheduled_for,
    'created_at', s.created_at, 'assigned_at', s.assigned_at, 'picked_up_at', s.picked_up_at,
    'delivered_at', s.delivered_at, 'cancelled_at', s.cancelled_at,
    'fare', case when sender then s.fare end,
    'fee_paise', case when sender then s.fee_paise end, 'fee_waived', case when sender then s.fee_waived end,
    'pickup_code', case when sender and s.status in ('booked', 'assigned') then c.pickup_code end,
    'delivery_code', case when s.status in ('booked', 'assigned', 'picked_up') then c.delivery_code end,
    'share_token', case when sender then s.share_token end,
    'photo', case when sender then s.parcel_photo_path end,
    'rider', case when j.assigned_to is not null and s.status in ('assigned', 'picked_up', 'delivered') then jsonb_build_object(
        'first_name', split_part(coalesce(v.legal_name, 'Rider'), ' ', 1), 'vehicle', v.vehicle,
        'plate_last4', right(regexp_replace(coalesce(v.vehicle_number, ''), '\s', '', 'g'), 4),
        -- The sender pays the fare at pickup, so the sender sees where to pay it.
        'upi', case when sender and s.status = 'assigned' then v.upi_id end) end,
    'rider_at', case when s.status in ('assigned', 'picked_up') and wl.updated_at > now() - interval '10 minutes'
                     then jsonb_build_object('lat', wl.lat, 'lng', wl.lng, 'at', wl.updated_at) end);
end;
$$;

create or replace function public.cancel_send(p_token text, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.sends;
  j public.jobs;
begin
  select * into s from public.sends where token = p_token for update;
  if s.id is null or length(coalesce(p_token, '')) < 20 then
    return 'not_found';
  end if;
  if s.status not in ('booked', 'assigned') then
    return 'too_late';
  end if;
  update public.sends set status = 'cancelled', cancelled_at = now(),
         cancel_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Cancelled by the sender'), 200)
   where id = s.id;
  if s.job_id is not null then
    select * into j from public.jobs where id = s.job_id;
    perform set_config('waggle.job_step', 'on', true);
    update public.jobs set status = 'cancelled', updated_at = now() where id = s.job_id and status in ('open', 'accepted');
    perform set_config('waggle.job_step', 'off', true);
    if j.assigned_to is not null then
      insert into public.notifications (id, user_id, title, description, kind, read, created_at)
      values (gen_random_uuid()::text, j.assigned_to, 'Parcel cancelled', 'The sender cancelled Send ' || s.code || '. No need to go.', 'job', false, now());
    end if;
  end if;
  return 'ok';
end;
$$;

create or replace function public.my_sends()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'token', token, 'status', status, 'drop_name', drop_name,
           'drop_area', drop_area, 'pickup_area', pickup_area, 'fare', fare, 'created_at', created_at, 'delivered_at', delivered_at)
           order by created_at desc), '[]'::jsonb)
    from (select * from public.sends where customer_id = auth.uid() order by created_at desc limit 30) x;
$$;

-- The rider carrying a Send: both people, what it is, and whether the photo is in.
create or replace function public.job_send_details(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('code', s.code,
           'pickup_name', s.pickup_name, 'pickup_phone', s.pickup_phone,
           'drop_name', s.drop_name, 'drop_phone', s.drop_phone,
           'kind', s.kind, 'size', s.size, 'fragile', s.fragile, 'description', s.description,
           'fare', s.fare, 'photo_taken', s.parcel_photo_path is not null)
    from public.sends s
    join public.jobs j on j.id = s.job_id
   where s.job_id = p_job and j.assigned_to = auth.uid() and j.status in ('accepted', 'picked_up');
$$;

create or replace function public.record_parcel_photo(p_job uuid, p_path text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.jobs where id = p_job and assigned_to = auth.uid() and status = 'accepted' and source = 'send') then
    return 'not_yours';
  end if;
  if p_path is null or p_path not like p_job::text || '/%' or p_path like '%..%' then
    return 'bad_path';
  end if;
  update public.sends set parcel_photo_path = p_path where job_id = p_job;
  return 'ok';
end;
$$;

-- Parcel photos: the rider carrying the job writes them, the rider and the sender read them.
insert into storage.buckets (id, name, public) values ('send-photos', 'send-photos', false) on conflict (id) do nothing;
drop policy if exists "send photos rider upload" on storage.objects;
create policy "send photos rider upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'send-photos' and exists (
    select 1 from public.jobs j where j.id::text = split_part(name, '/', 1) and j.assigned_to = auth.uid() and j.status = 'accepted' and j.source = 'send'));
drop policy if exists "send photos read" on storage.objects;
create policy "send photos read" on storage.objects for select to authenticated
  using (bucket_id = 'send-photos' and exists (
    select 1 from public.sends s join public.jobs j on j.id = s.job_id
     where j.id::text = split_part(name, '/', 1) and (s.customer_id = auth.uid() or j.assigned_to = auth.uid())));

revoke all on function public.send_quote(double precision, double precision, double precision, double precision) from public, anon;
revoke all on function public.book_send(text, text, text, text, double precision, double precision, text, text, text, text, double precision, double precision, text, text, boolean, text, text, boolean, timestamptz, text) from public, anon;
revoke all on function public.cancel_send(text, text) from public;
revoke all on function public.my_sends() from public, anon;
revoke all on function public.job_send_details(uuid) from public, anon;
revoke all on function public.record_parcel_photo(uuid, text) from public, anon;
revoke all on function public.admin_set_send_fee(boolean, integer) from public, anon;
grant execute on function public.send_quote(double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.book_send(text, text, text, text, double precision, double precision, text, text, text, text, double precision, double precision, text, text, boolean, text, text, boolean, timestamptz, text) to authenticated;
-- Tracking and cancelling work from a link, like shop orders: the token is the key.
grant execute on function public.track_send(text) to anon, authenticated;
grant execute on function public.cancel_send(text, text) to anon, authenticated;
grant execute on function public.my_sends() to authenticated;
grant execute on function public.job_send_details(uuid) to authenticated;
grant execute on function public.record_parcel_photo(uuid, text) to authenticated;
grant execute on function public.admin_set_send_fee(boolean, integer) to authenticated;
