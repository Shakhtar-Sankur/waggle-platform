-- ============================================================================
-- Waggle Business and Waggle Gig jobs: businesses, verification, billing,
-- catalogs, and every job from "posted" to "delivered".
--
-- Run AFTER waggle_gig_setup.sql and security_fixes.sql, and follow it with
-- business_v2.sql, every time: that file replaces some of what this one defines.
-- Safe to run again.
--
-- What this file guarantees, whatever any app sends:
--   * Businesses register themselves and start "pending". Only a Gigzen admin
--     verifies, rejects or pauses them. A restaurant cannot be verified without
--     an FSSAI number. Editing name, address or map pin sends a verified
--     business back to "pending".
--   * Workers submit ID, vehicle and UPI details and start "pending". Only a
--     Gigzen admin verifies them. Only verified workers see or accept Waggle jobs.
--   * Only a verified business posts jobs, through post_job(). The fare is
--     worked out here (Rs 25 for 2 km, Rs 9 a km after) and belongs to the worker.
--     Nobody can set or change it.
--   * The customer's full address is visible only to the business and the
--     worker who took the job. Pickup and delivery codes are visible only to
--     the business. A worker proves each step by entering the code:
--     accepted -> picked_up (shop's code) -> completed (customer's code).
--   * Waggle's money is a ledger the business can read and nobody but the
--     database can write: Rs 999 set-up when first verified, the plan's
--     monthly fee, and the plan's routing fee for each delivered order.
--
-- Job progress runs only through functions (accept_job, confirm_pickup,
-- confirm_delivery, release_job). They mark their transaction with
-- waggle.job_step, and the job guard refuses any worker change without it.
-- ============================================================================


-- ============================================================================ admins

create table if not exists public.admins (
  user_id  uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;

drop policy if exists "admins see themselves" on public.admins;
create policy "admins see themselves" on public.admins
  for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Making someone an admin is done by a founder in the Supabase SQL editor:
--   insert into public.admins (user_id)
--   select id from public.profiles where phone = '+91XXXXXXXXXX';


-- ============================================================================ businesses

create table if not exists public.businesses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null unique references public.profiles(id) on delete cascade,  -- one business per account, for now
  name        text not null check (length(btrim(name)) between 2 and 80),
  kind        text not null check (kind in ('restaurant', 'shop', 'pharmacy', 'other')),
  phone       text check (phone is null or length(phone) between 8 and 20),
  address     text not null check (length(btrim(address)) between 5 and 200),
  lat         double precision not null check (lat between -90 and 90),
  lng         double precision not null check (lng between -180 and 180),
  gstin       text check (gstin is null or gstin ~ '^[0-9A-Z]{15}$'),
  fssai       text check (fssai is null or fssai ~ '^[0-9]{14}$'),
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  verified_at timestamptz
);

alter table public.businesses add column if not exists plan text not null default 'starter';
alter table public.businesses add column if not exists review_note text;

alter table public.businesses drop constraint if exists businesses_status_check;
alter table public.businesses add constraint businesses_status_check
  check (status in ('pending', 'verified', 'rejected', 'suspended'));
alter table public.businesses drop constraint if exists businesses_plan_check;
alter table public.businesses add constraint businesses_plan_check
  check (plan in ('starter', 'growth', 'pro'));

alter table public.businesses enable row level security;

-- Only the owner (and Gigzen admins) see a business: phone, GSTIN and FSSAI are
-- not for other accounts. Workers learn what they need from the job itself.
drop policy if exists "business own read" on public.businesses;
create policy "business own read" on public.businesses
  for select to authenticated using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "business own insert" on public.businesses;
create policy "business own insert" on public.businesses
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists "business own update" on public.businesses;
create policy "business own update" on public.businesses
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.guard_business_write()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or current_setting('waggle.admin_step', true) = 'on' then
    return new;   -- the database itself, or an admin decision through admin_review_business()
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.plan := 'starter';
    new.review_note := null;
    new.verified_at := null;
    new.created_at := now();
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id
     or new.created_at is distinct from old.created_at
     or new.status is distinct from old.status
     or new.verified_at is distinct from old.verified_at
     or new.review_note is distinct from old.review_note then
    raise exception 'Only Gigzen can verify a business' using errcode = '42501';
  end if;
  if new.plan is distinct from old.plan and current_setting('waggle.plan_step', true) is distinct from 'on' then
    raise exception 'Change your plan from the Plans screen' using errcode = '42501';
  end if;
  -- What workers rely on changed, or a rejected business fixed its details:
  -- Gigzen looks again before the next job goes out.
  if (new.name, new.address, new.lat, new.lng, new.kind, new.fssai, new.gstin)
       is distinct from (old.name, old.address, old.lat, old.lng, old.kind, old.fssai, old.gstin)
     and old.status in ('verified', 'rejected') then
    new.status := 'pending';
    new.verified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_business_write on public.businesses;
create trigger trg_guard_business_write
  before insert or update on public.businesses
  for each row execute function public.guard_business_write();


-- ============================================================================ plans and billing

-- The report's prices, including GST: Starter free with a Rs 12 routing fee,
-- Growth Rs 999 a month with Rs 10, Pro Rs 2,499 a month with Rs 8.
create or replace function public.plan_routing_paise(p_plan text)
returns integer language sql immutable as $$
  select case p_plan when 'pro' then 800 when 'growth' then 1000 else 1200 end;
$$;

create or replace function public.plan_monthly_paise(p_plan text)
returns integer language sql immutable as $$
  select case p_plan when 'pro' then 249900 when 'growth' then 99900 else 0 end;
$$;

create or replace function public.plan_ad_credit_paise(p_plan text)
returns integer language sql immutable as $$
  select case p_plan when 'pro' then 100000 when 'growth' then 30000 else 0 end;
$$;

grant execute on function public.plan_routing_paise(text), public.plan_monthly_paise(text), public.plan_ad_credit_paise(text) to authenticated;

create table if not exists public.business_charges (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  kind         text not null check (kind in ('setup', 'plan', 'routing')),
  amount_paise integer not null check (amount_paise >= 0),
  description  text not null,
  job_id       uuid unique references public.jobs(id) on delete set null,   -- one routing charge per job
  period       date not null default (date_trunc('month', now()))::date,
  status       text not null default 'due' check (status in ('due', 'paid', 'waived')),
  created_at   timestamptz not null default now()
);

create index if not exists idx_business_charges on public.business_charges (business_id, period desc);

alter table public.business_charges enable row level security;

-- Read-only to the business and to admins. No insert, update or delete
-- policies: charges are written only by the functions in this file.
drop policy if exists "charges for their business" on public.business_charges;
create policy "charges for their business" on public.business_charges
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.businesses b where b.id = business_charges.business_id and b.owner_id = auth.uid()));

create or replace function public.change_plan(p_plan text)
returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.businesses;
begin
  if p_plan not in ('starter', 'growth', 'pro') then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  select * into b from public.businesses where owner_id = auth.uid();
  if b.id is null then
    raise exception 'Register your business first' using errcode = '42501';
  end if;
  if b.status <> 'verified' then
    raise exception 'Plans open once your business is verified' using errcode = '42501';
  end if;
  if b.plan = p_plan then
    return b;
  end if;
  perform set_config('waggle.plan_step', 'on', true);
  update public.businesses set plan = p_plan where id = b.id returning * into b;
  perform set_config('waggle.plan_step', 'off', true);
  -- The month is charged at the plan chosen; moving up bills the new plan once.
  if public.plan_monthly_paise(p_plan) > 0 and not exists (
      select 1 from public.business_charges c
       where c.business_id = b.id and c.kind = 'plan'
         and c.period = (date_trunc('month', now()))::date and c.description like initcap(p_plan) || '%') then
    insert into public.business_charges (business_id, kind, amount_paise, description)
    values (b.id, 'plan', public.plan_monthly_paise(p_plan), initcap(p_plan) || ' plan, ' || to_char(now(), 'FMMonth YYYY'));
  end if;
  return b;
end;
$$;

revoke all on function public.change_plan(text) from public, anon;
grant execute on function public.change_plan(text) to authenticated;


-- ============================================================================ catalog

create table if not exists public.catalog_items (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  description text check (description is null or length(description) <= 300),
  category    text check (category is null or length(category) <= 40),
  price_paise integer not null check (price_paise between 0 and 10000000),
  available   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_catalog_items on public.catalog_items (business_id, category, name);

alter table public.catalog_items enable row level security;

-- Whether a business is verified, without exposing the business row itself
-- (which only its owner and admins may read).
create or replace function public.is_verified_business(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.businesses where id = p_business and status = 'verified');
$$;

revoke all on function public.is_verified_business(uuid) from public, anon;
grant execute on function public.is_verified_business(uuid) to authenticated;

-- The owner manages the catalog. Anyone signed in may read the available items
-- of a verified business: that is what the Waggle app will show from April 2027.
drop policy if exists "catalog readable" on public.catalog_items;
create policy "catalog readable" on public.catalog_items
  for select to authenticated
  using (
    exists (select 1 from public.businesses b where b.id = catalog_items.business_id and b.owner_id = auth.uid())
    or (available and public.is_verified_business(catalog_items.business_id))
  );

drop policy if exists "catalog owner write" on public.catalog_items;
create policy "catalog owner write" on public.catalog_items
  for all to authenticated
  using (exists (select 1 from public.businesses b where b.id = catalog_items.business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.businesses b where b.id = catalog_items.business_id and b.owner_id = auth.uid()));


-- ============================================================================ worker verification

create table if not exists public.worker_verifications (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  legal_name     text not null check (length(btrim(legal_name)) between 2 and 80),
  vehicle        text not null check (vehicle in ('bicycle', 'bike', 'scooter', 'ev_scooter', 'auto', 'car', 'on_foot')),
  vehicle_number text check (vehicle_number is null or vehicle_number ~ '^[A-Z0-9 -]{4,15}$'),
  licence_number text check (licence_number is null or licence_number ~ '^[A-Z0-9 -]{6,20}$'),
  upi_id         text not null,
  id_type        text not null check (id_type in ('aadhaar_masked', 'voter_id', 'pan', 'passport', 'driving_licence')),
  id_photo_path  text not null,
  selfie_path    text not null,
  status         text not null default 'pending' check (status in ('pending', 'verified', 'rejected', 'suspended')),
  review_note    text,
  submitted_at   timestamptz not null default now(),
  verified_at    timestamptz
);

-- A UPI ID: name@bank. (Postgres allows repeat counts up to 255.)
alter table public.worker_verifications drop constraint if exists worker_verifications_upi_id_check;
alter table public.worker_verifications add constraint worker_verifications_upi_id_check
  check (upi_id ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$');

-- Anyone riding a motor vehicle shows the licence and the vehicle's RC, as
-- photos and not just numbers. NOT VALID so rows from before this rule do not
-- stop the file; every new or changed row must pass it.
alter table public.worker_verifications add column if not exists licence_photo_path text;
alter table public.worker_verifications add column if not exists rc_photo_path text;
alter table public.worker_verifications drop constraint if exists worker_verifications_motor_check;
alter table public.worker_verifications add constraint worker_verifications_motor_check
  check (vehicle in ('bicycle', 'on_foot')
         or (vehicle_number is not null and licence_number is not null
             and licence_photo_path is not null and rc_photo_path is not null)) not valid;

alter table public.worker_verifications enable row level security;

drop policy if exists "verification own read" on public.worker_verifications;
create policy "verification own read" on public.worker_verifications
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "verification own insert" on public.worker_verifications;
create policy "verification own insert" on public.worker_verifications
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "verification own update" on public.worker_verifications;
create policy "verification own update" on public.worker_verifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.guard_worker_verification()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or current_setting('waggle.admin_step', true) = 'on' then
    return new;
  end if;
  -- Papers must be this worker's own uploads: nobody gets verified on someone else's.
  if exists (select 1 from unnest(array[new.id_photo_path, new.selfie_path, new.licence_photo_path, new.rc_photo_path]) as doc
              where doc is not null and (left(doc, length(new.user_id::text) + 1) <> new.user_id::text || '/' or position('..' in doc) > 0)) then
    raise exception 'Documents must be uploaded from this account' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.review_note := null;
    new.verified_at := null;
    new.submitted_at := now();
    return new;
  end if;
  if new.user_id is distinct from old.user_id
     or new.status is distinct from old.status
     or new.verified_at is distinct from old.verified_at
     or new.review_note is distinct from old.review_note then
    raise exception 'Only Gigzen can verify a worker' using errcode = '42501';
  end if;
  if old.status = 'suspended' then
    raise exception 'This account is paused. Contact Gigzen support.' using errcode = '42501';
  end if;
  -- Any change to the details is a new submission: Gigzen checks it again.
  new.status := 'pending';
  new.verified_at := null;
  new.submitted_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_worker_verification on public.worker_verifications;
create trigger trg_guard_worker_verification
  before insert or update on public.worker_verifications
  for each row execute function public.guard_worker_verification();

create or replace function public.is_verified_worker(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.worker_verifications v where v.user_id = p_user and v.status = 'verified');
$$;

revoke all on function public.is_verified_worker(uuid) from public, anon;
grant execute on function public.is_verified_worker(uuid) to authenticated;

-- ID photos and selfies: a private bucket. Each worker writes and reads only
-- their own folder; admins read all of it to review.
insert into storage.buckets (id, name, public)
values ('worker-docs', 'worker-docs', false)
on conflict (id) do update set public = false;

drop policy if exists "worker docs upload own" on storage.objects;
create policy "worker docs upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'worker-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "worker docs replace own" on storage.objects;
create policy "worker docs replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'worker-docs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'worker-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "worker docs read own or admin" on storage.objects;
create policy "worker docs read own or admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'worker-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));


-- ============================================================================ admin review

drop function if exists public.admin_business_queue();   -- business_v2.sql gives it a different shape
create function public.admin_business_queue()
returns table (
  id uuid, name text, kind text, phone text, address text, lat double precision, lng double precision,
  gstin text, fssai text, status text, plan text, review_note text, created_at timestamptz,
  owner_name text, owner_phone text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select b.id, b.name, b.kind, b.phone, b.address, b.lat, b.lng, b.gstin, b.fssai, b.status, b.plan,
           b.review_note, b.created_at, p.full_name, p.phone
      from public.businesses b
      join public.profiles p on p.id = b.owner_id
     order by (b.status = 'pending') desc, b.created_at desc;
end;
$$;

create or replace function public.admin_review_business(p_business uuid, p_decision text, p_note text default null)
returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.businesses;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select * into b from public.businesses where id = p_business;
  if b.id is null then
    raise exception 'No such business' using errcode = '22023';
  end if;
  if p_decision not in ('verify', 'reject', 'suspend') then
    raise exception 'Decide verify, reject or suspend' using errcode = '22023';
  end if;
  if p_decision in ('reject', 'suspend') and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Tell the business why, so they can fix it' using errcode = '22023';
  end if;
  if p_decision = 'verify' and b.kind = 'restaurant' and b.fssai is null then
    raise exception 'A restaurant needs an FSSAI number before it can be verified' using errcode = '22023';
  end if;

  perform set_config('waggle.admin_step', 'on', true);
  update public.businesses
     set status = case p_decision when 'verify' then 'verified' when 'reject' then 'rejected' else 'suspended' end,
         verified_at = case when p_decision = 'verify' then now() else verified_at end,
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = b.id
  returning * into b;
  perform set_config('waggle.admin_step', 'off', true);

  -- The Rs 999 set-up fee, once, when a business is first verified.
  if p_decision = 'verify' and not exists (select 1 from public.business_charges where business_id = b.id and kind = 'setup') then
    insert into public.business_charges (business_id, kind, amount_paise, description)
    values (b.id, 'setup', 99900, 'Waggle Business set-up');
  end if;
  return b;
end;
$$;

drop function if exists public.admin_worker_queue();
create function public.admin_worker_queue()
returns table (
  user_id uuid, legal_name text, vehicle text, vehicle_number text, licence_number text, upi_id text,
  id_type text, id_photo_path text, selfie_path text, status text, review_note text, submitted_at timestamptz,
  profile_name text, profile_phone text, licence_photo_path text, rc_photo_path text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select v.user_id, v.legal_name, v.vehicle, v.vehicle_number, v.licence_number, v.upi_id, v.id_type,
           v.id_photo_path, v.selfie_path, v.status, v.review_note, v.submitted_at, p.full_name, p.phone,
           v.licence_photo_path, v.rc_photo_path
      from public.worker_verifications v
      join public.profiles p on p.id = v.user_id
     order by (v.status = 'pending') desc, v.submitted_at desc;
end;
$$;

create or replace function public.admin_review_worker(p_user uuid, p_decision text, p_note text default null)
returns public.worker_verifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.worker_verifications;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if p_decision not in ('verify', 'reject', 'suspend') then
    raise exception 'Decide verify, reject or suspend' using errcode = '22023';
  end if;
  if p_decision in ('reject', 'suspend') and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Tell the worker why, so they can fix it' using errcode = '22023';
  end if;
  if p_user = auth.uid() then
    raise exception 'An admin cannot verify their own worker account' using errcode = '42501';
  end if;
  perform set_config('waggle.admin_step', 'on', true);
  update public.worker_verifications
     set status = case p_decision when 'verify' then 'verified' when 'reject' then 'rejected' else 'suspended' end,
         verified_at = case when p_decision = 'verify' then now() else verified_at end,
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where user_id = p_user
  returning * into v;
  perform set_config('waggle.admin_step', 'off', true);
  if v.user_id is null then
    raise exception 'This worker has not asked to be verified' using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke all on function public.admin_business_queue() from public, anon;
revoke all on function public.admin_review_business(uuid, text, text) from public, anon;
revoke all on function public.admin_worker_queue() from public, anon;
revoke all on function public.admin_review_worker(uuid, text, text) from public, anon;
grant execute on function public.admin_business_queue() to authenticated;
grant execute on function public.admin_review_business(uuid, text, text) to authenticated;
grant execute on function public.admin_worker_queue() to authenticated;
grant execute on function public.admin_review_worker(uuid, text, text) to authenticated;


-- ============================================================================ jobs, from businesses

alter table public.jobs add column if not exists business_id uuid references public.businesses(id) on delete set null;
alter table public.jobs add column if not exists picked_up_at timestamptz;
alter table public.jobs add column if not exists delivered_at timestamptz;
create index if not exists idx_jobs_business on public.jobs (business_id, created_at desc);
create index if not exists idx_jobs_assigned on public.jobs (assigned_to, status);

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('open', 'accepted', 'picked_up', 'completed', 'declined', 'cancelled'));

-- Only verified workers see open jobs. The business sees its own; the worker
-- sees the jobs they hold.
drop policy if exists "jobs readable" on public.jobs;
create policy "jobs readable" on public.jobs
  for select to authenticated
  using (
    (assigned_to is null and status = 'open' and public.is_verified_worker(auth.uid()))
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  );

-- The customer's details, apart from the job every nearby worker can see.
create table if not exists public.job_details (
  job_id          uuid primary key references public.jobs(id) on delete cascade,
  dropoff_address text not null,
  dropoff_lat     double precision not null,
  dropoff_lng     double precision not null,
  customer_note   text
);

alter table public.job_details enable row level security;

drop policy if exists "job details for its business and worker" on public.job_details;
create policy "job details for its business and worker" on public.job_details
  for select to authenticated
  using (exists (
    select 1 from public.jobs j
     where j.id = job_details.job_id
       and (j.created_by = auth.uid() or j.assigned_to = auth.uid())
  ));

-- The two handover codes. Only the business reads them: it tells the pickup
-- code to the worker at the counter, and sends the delivery code to the customer.
create table if not exists public.job_codes (
  job_id            uuid primary key references public.jobs(id) on delete cascade,
  pickup_code       text not null check (pickup_code ~ '^[0-9]{4}$'),
  delivery_code     text not null check (delivery_code ~ '^[0-9]{4}$'),
  pickup_attempts   integer not null default 0,
  delivery_attempts integer not null default 0
);

alter table public.job_codes enable row level security;

drop policy if exists "job codes for its business" on public.job_codes;
create policy "job codes for its business" on public.job_codes
  for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_codes.job_id and j.created_by = auth.uid()));

create or replace function public.delivery_fare(p_km numeric)
returns numeric
language sql
immutable
as $$
  select round(25 + greatest(0, p_km - 2) * 9);
$$;

grant execute on function public.delivery_fare(numeric) to authenticated;

-- Where a job came from: the Waggle Business app, the delivery API, or an
-- order a customer placed on the shop's link. business_v2.sql uses the last two.
alter table public.jobs add column if not exists source text not null default 'app';
alter table public.jobs drop constraint if exists jobs_source_check;
alter table public.jobs add constraint jobs_source_check check (source in ('app', 'api', 'order'));
alter table public.jobs add column if not exists external_ref text check (external_ref is null or length(external_ref) <= 64);

-- Every job a business sends goes through this one function, whichever door it
-- came in by, so the checks and the fare are the same for all of them. It is
-- callable only from the functions in these files, never by an app.
create or replace function public._post_job_core(
  p_business        uuid,
  p_dropoff_area    text,
  p_dropoff_address text,
  p_dropoff_lat     double precision,
  p_dropoff_lng     double precision,
  p_note            text,
  p_source          text default 'app',
  p_external_ref    text default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  b        public.businesses;
  straight double precision;
  road_km  numeric;
  open_now int;
  posted   public.jobs;
begin
  select * into b from public.businesses where id = p_business;
  if b.id is null then
    raise exception 'Register your business first' using errcode = '42501';
  end if;
  if b.status <> 'verified' then
    raise exception 'Your business is waiting for verification' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_dropoff_area, ''))) not between 2 and 60
     or length(btrim(coalesce(p_dropoff_address, ''))) not between 5 and 200 then
    raise exception 'Add the drop-off area and address' using errcode = '22023';
  end if;
  if p_dropoff_lat is null or p_dropoff_lng is null
     or p_dropoff_lat not between -90 and 90 or p_dropoff_lng not between -180 and 180 then
    raise exception 'Pin the drop-off on the map' using errcode = '22023';
  end if;
  if p_note is not null and length(p_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;

  straight := public.km_between(b.lat, b.lng, p_dropoff_lat, p_dropoff_lng);
  if straight > 25 then
    raise exception 'Waggle delivers within 25 km of the business' using errcode = '22023';
  end if;
  if straight < 0.05 then
    raise exception 'The drop-off is at the business itself' using errcode = '22023';
  end if;

  -- Roads are longer than a straight line; 1.3 is the usual city allowance.
  road_km := round((straight * 1.3)::numeric, 1);

  select count(*) into open_now from public.jobs where business_id = b.id and status = 'open';
  if open_now >= 30 then
    raise exception 'Too many jobs waiting for a worker; cancel some first' using errcode = '54000';
  end if;

  insert into public.jobs (title, pickup, dropoff, distance_km, payout, app, eta_minutes, status,
                           created_by, business_id, fee_paise, note, pickup_lat, pickup_lng, source, external_ref)
  values ('Delivery from ' || b.name,
          b.name || ', ' || b.address,
          btrim(p_dropoff_area),
          road_km,
          public.delivery_fare(road_km),
          'waggle',
          greatest(5, round(road_km * 3)::int + 5),
          'open',
          b.owner_id,
          b.id,
          public.plan_routing_paise(b.plan),   -- Waggle's fee at this business's plan, not the worker's money
          nullif(btrim(coalesce(p_note, '')), ''),
          b.lat,
          b.lng,
          p_source,
          nullif(btrim(coalesce(p_external_ref, '')), ''))
  returning * into posted;

  insert into public.job_details (job_id, dropoff_address, dropoff_lat, dropoff_lng, customer_note)
  values (posted.id, btrim(p_dropoff_address), p_dropoff_lat, p_dropoff_lng, nullif(btrim(coalesce(p_note, '')), ''));

  insert into public.job_codes (job_id, pickup_code, delivery_code)
  values (posted.id,
          lpad((floor(random() * 10000))::int::text, 4, '0'),
          lpad((floor(random() * 10000))::int::text, 4, '0'));

  return posted;
end;
$$;

revoke all on function public._post_job_core(uuid, text, text, double precision, double precision, text, text, text) from public, anon, authenticated;

-- The Waggle Business app's door: the signed-in owner's own business.
create or replace function public.post_job(
  p_dropoff_area    text,
  p_dropoff_address text,
  p_dropoff_lat     double precision,
  p_dropoff_lng     double precision,
  p_note            text default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  b_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select id into b_id from public.businesses where owner_id = auth.uid();
  return public._post_job_core(b_id, p_dropoff_area, p_dropoff_address, p_dropoff_lat, p_dropoff_lng, p_note, 'app', null);
end;
$$;

revoke all on function public.post_job(text, text, double precision, double precision, text) from public, anon;
grant execute on function public.post_job(text, text, double precision, double precision, text) to authenticated;


-- ============================================================================ job steps

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
  if not public.is_verified_worker(auth.uid()) then
    raise exception 'Get verified to take Waggle jobs' using errcode = '42501';
  end if;

  perform set_config('waggle.job_step', 'on', true);
  -- First accept wins: the WHERE clause is the whole rule, under the row lock.
  update public.jobs
     set status = 'accepted', assigned_to = auth.uid(), accepted_at = now(), updated_at = now()
   where id = p_job_id and status = 'open' and assigned_to is null
  returning * into claimed;
  perform set_config('waggle.job_step', 'off', true);

  return claimed;   -- null when somebody else got there first
end;
$$;

revoke all on function public.accept_job(uuid) from public, anon;
grant execute on function public.accept_job(uuid) to authenticated;

-- Wrong codes are counted, and five wrong tries lock the step: a four-digit
-- code cannot be guessed in five. These return a word rather than raising,
-- because raising would roll back the count.
create or replace function public.confirm_pickup(p_job_id uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs;
  c public.job_codes;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if j.id is null or j.assigned_to is distinct from auth.uid() or j.status <> 'accepted' then
    return 'not_yours';
  end if;
  select * into c from public.job_codes where job_id = j.id for update;
  if c.job_id is null then
    return 'no_code';
  end if;
  if c.pickup_attempts >= 5 then
    return 'locked';
  end if;
  if btrim(coalesce(p_code, '')) <> c.pickup_code then
    update public.job_codes set pickup_attempts = pickup_attempts + 1 where job_id = j.id;
    return case when c.pickup_attempts + 1 >= 5 then 'locked' else 'wrong' end;
  end if;
  perform set_config('waggle.job_step', 'on', true);
  update public.jobs set status = 'picked_up', picked_up_at = now(), updated_at = now() where id = j.id;
  perform set_config('waggle.job_step', 'off', true);
  return 'ok';
end;
$$;

create or replace function public.confirm_delivery(p_job_id uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs;
  c public.job_codes;
  b public.businesses;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if j.id is null or j.assigned_to is distinct from auth.uid() or j.status <> 'picked_up' then
    return 'not_yours';
  end if;
  select * into c from public.job_codes where job_id = j.id for update;
  if c.job_id is null then
    return 'no_code';
  end if;
  if c.delivery_attempts >= 5 then
    return 'locked';
  end if;
  if btrim(coalesce(p_code, '')) <> c.delivery_code then
    update public.job_codes set delivery_attempts = delivery_attempts + 1 where job_id = j.id;
    return case when c.delivery_attempts + 1 >= 5 then 'locked' else 'wrong' end;
  end if;
  perform set_config('waggle.job_step', 'on', true);
  update public.jobs set status = 'completed', delivered_at = now(), updated_at = now() where id = j.id;
  perform set_config('waggle.job_step', 'off', true);

  -- Waggle's routing fee, at the rate fixed when the job was posted.
  select * into b from public.businesses where id = j.business_id;
  if b.id is not null then
    insert into public.business_charges (business_id, kind, amount_paise, description, job_id)
    values (b.id, 'routing', j.fee_paise, 'Delivery to ' || j.dropoff, j.id)
    on conflict (job_id) do nothing;
  end if;
  return 'ok';
end;
$$;

-- A worker who cannot make it hands the job back, but only before pickup:
-- once they hold the goods, they deliver them.
create or replace function public.release_job(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job_id for update;
  if j.id is null or j.assigned_to is distinct from auth.uid() then
    return 'not_yours';
  end if;
  if j.status <> 'accepted' then
    return 'too_late';
  end if;
  perform set_config('waggle.job_step', 'on', true);
  update public.jobs set status = 'open', assigned_to = null, accepted_at = null, updated_at = now() where id = j.id;
  perform set_config('waggle.job_step', 'off', true);
  return 'ok';
end;
$$;

revoke all on function public.confirm_pickup(uuid, text) from public, anon;
revoke all on function public.confirm_delivery(uuid, text) from public, anon;
revoke all on function public.release_job(uuid) from public, anon;
grant execute on function public.confirm_pickup(uuid, text) to authenticated;
grant execute on function public.confirm_delivery(uuid, text) to authenticated;
grant execute on function public.release_job(uuid) to authenticated;


-- ============================================================================ who may change a job
--
-- Replaces the guard in security_fixes.sql (keep the two identical).
--   * The business may cancel its own job while nobody has taken it, and edit
--     its note; nothing else, so the fare a worker saw is the fare they get.
--   * Once a worker holds a job, the business can no longer touch it.
--   * A worker's changes happen only inside the job-step functions above.

create or replace function public.guard_job_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or current_setting('waggle.job_step', true) = 'on' then
    return new;
  end if;
  if old.created_by = auth.uid() and old.assigned_to is null then
    if (to_jsonb(new) - array['status', 'note', 'updated_at'])
       is distinct from (to_jsonb(old) - array['status', 'note', 'updated_at'])
       or (new.status is distinct from old.status and not (old.status = 'open' and new.status = 'cancelled')) then
      raise exception 'A business can cancel an open job or edit its note, nothing else' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'Jobs move forward only through the app''s job steps' using errcode = '42501';
end;
$$;

drop trigger if exists trg_guard_job_update on public.jobs;
create trigger trg_guard_job_update
  before update on public.jobs
  for each row execute function public.guard_job_update();
