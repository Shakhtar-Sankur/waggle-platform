-- ============================================================================
-- WAGGLE: TEST RUN FILE 2 of September 24, 2026 (riders and month end).
-- Project: jqepegeifmnfofeyebrz (TEST) ONLY.
-- Paste this whole file into the Supabase SQL Editor and press Run, once.
-- Contains: business_v2.sql, updated. Everything already applied is skipped or
-- replaced in place; it adds automatic month-end billing (1st of each month,
-- 05:35 India time), new-job alerts for nearby riders, and shops paying riders
-- by UPI with the UTR recorded.
--
-- If the month-end schedule check says false: open Database > Extensions in
-- Supabase, turn on pg_cron, and run this file again.
-- ============================================================================

-- ============================================================================
-- Waggle Business, part two: who stands behind a business, every kind of shop,
-- GST invoices and UPI payments, reports, ads, the delivery API, and orders
-- from customers on the shop's own link.
--
-- Run AFTER business.sql. Safe to run again.
--
-- What this file guarantees, whatever any app sends:
--   * Every kind of shop can register: food, groceries, pharmacy, electronics,
--     fashion and the rest. Each category asks for the licence the law asks of
--     it: FSSAI for anything edible, a drug licence for a pharmacy.
--   * Gigzen cannot verify a business until the owner has given their name,
--     PAN, the last four digits of their Aadhaar, photos of the PAN card, the
--     masked Aadhaar, a selfie and the shop front, proof the business exists
--     (GST certificate, Shop & Establishment or trade licence, or Udyam), a
--     GSTIN or a dated declaration that it is below the GST limit, where to be
--     paid, and the category's licence with an expiry date that has not passed.
--     Only the last four Aadhaar digits are ever stored.
--   * An admin verifies only after ticking every check the business needs, and
--     every decision is logged with who made it and what they checked.
--   * A licence that expires stops the shop: no deliveries, no orders, hidden
--     from customers, until the owner renews it and Gigzen looks again.
--   * Documents are the owner's own uploads, in a private store only they and
--     Gigzen's admins can open. Changing any of it, the bank account included,
--     sends a verified business back to review.
--   * Invoices are numbered and written by the database alone, GST worked out
--     from Gigzen's registration and the business's state. Payments are UPI
--     transfers the business reports with its UTR; an admin confirms each one,
--     and a UTR can be used once.
--   * An API key is shown once and stored only as a hash. Anyone holding a key
--     acts as that business and nothing more, within a rate limit.
--   * Customers order from a verified shop's link without an account. Prices
--     come from the catalog, never from the customer, and every limit on how
--     many orders a phone may place is checked here.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;


-- ============================================================================ categories

-- One list for every kind of shop. 'shop' (the old catch-all) becomes 'other';
-- the owner picks the real category when they complete verification.
alter table public.businesses drop constraint if exists businesses_kind_check;
update public.businesses set kind = 'other' where kind = 'shop';
alter table public.businesses add constraint businesses_kind_check check (kind in (
  'restaurant', 'cafe', 'cloud_kitchen', 'bakery',
  'grocery', 'fruits_veg', 'meat_fish', 'dairy',
  'pharmacy',
  'electronics', 'fashion', 'home_kitchen', 'books', 'beauty', 'toys', 'pets', 'flowers_gifts', 'hardware',
  'other'));

-- The licence a category needs before Gigzen verifies it.
create or replace function public.kind_licence(p_kind text)
returns text
language sql
immutable
as $$
  select case
    when p_kind in ('restaurant', 'cafe', 'cloud_kitchen', 'bakery', 'grocery', 'fruits_veg', 'meat_fish', 'dairy') then 'fssai'
    when p_kind = 'pharmacy' then 'drug'
    else null
  end;
$$;

grant execute on function public.kind_licence(text) to anon, authenticated;


-- ============================================================================ who stands behind the business

alter table public.businesses
  add column if not exists entity_type           text,
  add column if not exists owner_name            text,
  add column if not exists pan                   text,
  add column if not exists aadhaar_last4         text,
  add column if not exists state_code            text,
  add column if not exists drug_licence          text,
  add column if not exists udyam                 text,
  add column if not exists payout_method         text,
  add column if not exists bank_account_name     text,
  add column if not exists bank_account_number   text,
  add column if not exists bank_ifsc             text,
  add column if not exists payout_upi            text,
  add column if not exists doc_pan               text,
  add column if not exists doc_aadhaar           text,
  add column if not exists doc_selfie            text,
  add column if not exists doc_shopfront         text,
  add column if not exists doc_fssai             text,
  add column if not exists doc_drug_licence      text,
  add column if not exists doc_proof             text,
  add column if not exists proof_type            text,
  add column if not exists proof_number          text,
  add column if not exists gst_exempt_declared_at timestamptz,
  add column if not exists fssai_expires_on      date,
  add column if not exists drug_licence_expires_on date,
  add column if not exists delivery_charge_paise integer not null default 0,
  add column if not exists shop_open             boolean not null default true;

-- Proof of the business replaced an optional certificate photo.
alter table public.businesses drop column if exists doc_establishment;

do $$
declare
  c record;
begin
  for c in select * from (values
    ('businesses_entity_type_check',  $c$entity_type is null or entity_type in ('proprietor', 'partnership', 'llp', 'private_ltd', 'public_ltd', 'trust', 'other')$c$),
    ('businesses_owner_name_check',   $c$owner_name is null or length(btrim(owner_name)) between 2 and 80$c$),
    ('businesses_pan_check',          $c$pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'$c$),
    ('businesses_aadhaar_last4_check',$c$aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'$c$),
    ('businesses_state_code_check',   $c$state_code is null or state_code in ('01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','26','27','29','30','31','32','33','34','35','36','37','38')$c$),
    ('businesses_drug_licence_check', $c$drug_licence is null or drug_licence ~ '^[A-Za-z0-9/ .()-]{4,40}$'$c$),
    ('businesses_udyam_check',        $c$udyam is null or udyam ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'$c$),
    ('businesses_payout_method_check',$c$payout_method is null or payout_method in ('bank', 'upi')$c$),
    ('businesses_bank_name_check',    $c$bank_account_name is null or length(btrim(bank_account_name)) between 2 and 80$c$),
    ('businesses_bank_number_check',  $c$bank_account_number is null or bank_account_number ~ '^[0-9]{9,18}$'$c$),
    ('businesses_bank_ifsc_check',    $c$bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'$c$),
    ('businesses_payout_upi_check',   $c$payout_upi is null or payout_upi ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$'$c$),
    ('businesses_docs_check',         $c$coalesce(greatest(length(doc_pan), length(doc_aadhaar), length(doc_selfie), length(doc_shopfront), length(doc_fssai), length(doc_drug_licence), length(doc_proof)), 0) <= 200$c$),
    ('businesses_proof_type_check',   $c$proof_type is null or proof_type in ('gst', 'establishment', 'trade_licence', 'udyam')$c$),
    ('businesses_proof_number_check', $c$proof_number is null or proof_number ~ '^[A-Za-z0-9/ .()-]{4,40}$'$c$),
    ('businesses_gst_declared_check', $c$gstin is null or gst_exempt_declared_at is null$c$),
    ('businesses_delivery_charge_check', $c$delivery_charge_paise between 0 and 50000$c$),
    -- A GSTIN carries the PAN in characters 3 to 12 and the state in the first two.
    ('businesses_gstin_pan_check',    $c$gstin is null or pan is null or substr(gstin, 3, 10) = pan$c$),
    ('businesses_gstin_state_check',  $c$gstin is null or state_code is null or left(gstin, 2) = state_code$c$)
  ) as t(name, expr) loop
    execute format('alter table public.businesses drop constraint if exists %I', c.name);
    execute format('alter table public.businesses add constraint %I check (%s)', c.name, c.expr);
  end loop;
end
$$;

-- The GSTIN's full shape: state, PAN, entity number, Z, check character.
-- NOT VALID so an older, looser entry does not stop this file; it holds for every write from now on.
alter table public.businesses drop constraint if exists businesses_gstin_check;
alter table public.businesses add constraint businesses_gstin_check
  check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$') not valid;

-- What is still needed before Gigzen can verify this business, by name.
create or replace function public.business_kyc_missing(b public.businesses)
returns text[]
language sql
stable
as $$
  select array_remove(array[
    case when b.entity_type is null then 'entity_type' end,
    case when b.owner_name is null then 'owner_name' end,
    case when b.pan is null then 'pan' end,
    case when b.aadhaar_last4 is null then 'aadhaar' end,
    case when b.state_code is null then 'state' end,
    case when b.doc_pan is null then 'doc_pan' end,
    case when b.doc_aadhaar is null then 'doc_aadhaar' end,
    case when b.doc_selfie is null then 'doc_selfie' end,
    case when b.doc_shopfront is null then 'doc_shopfront' end,
    case when b.payout_method is null
           or (b.payout_method = 'bank' and (b.bank_account_name is null or b.bank_account_number is null or b.bank_ifsc is null))
           or (b.payout_method = 'upi' and b.payout_upi is null) then 'payout' end,
    case when public.kind_licence(b.kind) = 'fssai' and b.fssai is null then 'fssai' end,
    case when public.kind_licence(b.kind) = 'fssai' and b.doc_fssai is null then 'doc_fssai' end,
    case when public.kind_licence(b.kind) = 'drug' and b.drug_licence is null then 'drug_licence' end,
    case when public.kind_licence(b.kind) = 'drug' and b.doc_drug_licence is null then 'doc_drug_licence' end,
    case when b.proof_type is null or b.proof_number is null or b.doc_proof is null then 'proof' end,
    case when b.gstin is null and b.gst_exempt_declared_at is null then 'gst' end,
    case when public.kind_licence(b.kind) = 'fssai' and b.fssai_expires_on is null then 'fssai_expiry' end,
    case when public.kind_licence(b.kind) = 'fssai' and b.fssai_expires_on < current_date then 'fssai_expired' end,
    case when public.kind_licence(b.kind) = 'drug' and b.drug_licence_expires_on is null then 'drug_expiry' end,
    case when public.kind_licence(b.kind) = 'drug' and b.drug_licence_expires_on < current_date then 'drug_expired' end
  ], null);
$$;

-- The category's licence is in date. A shop whose licence lapses stops taking
-- deliveries and orders until it is renewed and Gigzen has looked again.
create or replace function public.business_licence_ok(b public.businesses)
returns boolean
language sql
stable
as $$
  select case public.kind_licence(b.kind)
           when 'fssai' then coalesce(b.fssai_expires_on >= current_date, false)
           when 'drug' then coalesce(b.drug_licence_expires_on >= current_date, false)
           else true
         end;
$$;

-- What the reviewer must have looked at, and ticked, before Verify works.
create or replace function public.business_required_checks(b public.businesses)
returns text[]
language sql
stable
as $$
  select array_remove(array[
    'pan_name_matches',    -- the PAN photo shows the owner's name and number as typed
    'aadhaar_masked',      -- only the last four digits show, and they match
    'selfie_matches',      -- the selfie is the person on the PAN / Aadhaar
    'shopfront_board',     -- the shop front shows the business's name board
    'proof_valid',         -- the business proof is real, current, and in this name and address
    'payout_name_matches', -- the bank account or UPI belongs to the owner or the business
    case when b.gstin is not null then 'gstin_valid' end,          -- checked on the GST portal
    case when public.kind_licence(b.kind) = 'fssai' then 'fssai_valid' end,  -- checked on FoSCoS
    case when public.kind_licence(b.kind) = 'drug' then 'drug_valid' end
  ], null);
$$;

revoke all on function public.business_licence_ok(public.businesses) from public, anon;
revoke all on function public.business_required_checks(public.businesses) from public, anon;
grant execute on function public.business_licence_ok(public.businesses) to authenticated;
grant execute on function public.business_required_checks(public.businesses) to authenticated;
revoke all on function public.business_kyc_missing(public.businesses) from public, anon;
grant execute on function public.business_kyc_missing(public.businesses) to authenticated;

create or replace function public.my_business_missing()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select public.business_kyc_missing(b) from public.businesses b where b.owner_id = auth.uid();
$$;

revoke all on function public.my_business_missing() from public, anon;
grant execute on function public.my_business_missing() to authenticated;

-- Replaces the guard in business.sql.
create or replace function public.guard_business_write()
returns trigger
language plpgsql
as $$
declare
  folder text;
  doc    text;
  quiet  constant text[] := array['phone', 'delivery_charge_paise', 'shop_open', 'plan', 'prep_minutes'];
begin
  if auth.uid() is null or current_setting('waggle.admin_step', true) = 'on' then
    return new;   -- the database itself, or an admin decision through admin_review_business()
  end if;

  -- Papers must be this owner's own uploads: nobody gets verified on someone else's.
  folder := new.owner_id::text || '/';
  foreach doc in array array[new.doc_pan, new.doc_aadhaar, new.doc_selfie, new.doc_shopfront,
                             new.doc_fssai, new.doc_drug_licence, new.doc_proof] loop
    if doc is not null and (left(doc, length(folder)) <> folder or position('..' in doc) > 0) then
      raise exception 'Documents must be uploaded from this account' using errcode = '42501';
    end if;
  end loop;

  -- The below-the-GST-limit declaration carries the moment the owner made it,
  -- set here and nowhere else; a GSTIN replaces it.
  if new.gstin is not null then
    new.gst_exempt_declared_at := null;
  elsif new.gst_exempt_declared_at is not null then
    new.gst_exempt_declared_at := case when tg_op = 'UPDATE' and old.gst_exempt_declared_at is not null
                                       then old.gst_exempt_declared_at else now() end;
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
  -- Anything Gigzen checked has changed, the payout account included, or a
  -- rejected business fixed its details: Gigzen looks again before the next job.
  -- The phone, the delivery charge and whether the shop is open are the
  -- owner's to change freely.
  if (to_jsonb(new) - quiet) is distinct from (to_jsonb(old) - quiet)
     and old.status in ('verified', 'rejected') then
    new.status := 'pending';
    new.verified_at := null;
  end if;
  return new;
end;
$$;

-- ID photos, the shop front and licences: a private bucket, like the workers'.
insert into storage.buckets (id, name, public)
values ('business-docs', 'business-docs', false)
on conflict (id) do update set public = false;

drop policy if exists "business docs upload own" on storage.objects;
create policy "business docs upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'business-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "business docs replace own" on storage.objects;
create policy "business docs replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'business-docs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'business-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "business docs read own or admin" on storage.objects;
create policy "business docs read own or admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'business-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Every decision on a business, with who made it and what they had ticked.
create table if not exists public.business_review_log (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  admin_id    uuid references public.profiles(id) on delete set null,
  decision    text not null check (decision in ('verify', 'reject', 'suspend')),
  checks      text[] not null default '{}',
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_business_review_log on public.business_review_log (business_id, created_at desc);
alter table public.business_review_log enable row level security;

drop policy if exists "review log for admins" on public.business_review_log;
create policy "review log for admins" on public.business_review_log
  for select to authenticated using (public.is_admin());

-- The review queue now carries everything the admin checks, as one object per
-- business: its row, the account holder's profile name and phone, and what is missing.
drop function if exists public.admin_business_queue();
create function public.admin_business_queue()
returns setof jsonb
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
    select to_jsonb(b) || jsonb_build_object(
             'profile_name', p.full_name,
             'profile_phone', p.phone,
             'licence', public.kind_licence(b.kind),
             'licence_ok', public.business_licence_ok(b),
             'required_checks', to_jsonb(public.business_required_checks(b)),
             'missing', to_jsonb(public.business_kyc_missing(b)),
             'last_review', (select jsonb_build_object('decision', l.decision, 'checks', l.checks, 'at', l.created_at, 'by', a.full_name)
                               from public.business_review_log l left join public.profiles a on a.id = l.admin_id
                              where l.business_id = b.id order by l.created_at desc limit 1))
      from public.businesses b
      join public.profiles p on p.id = b.owner_id
     order by (b.status = 'pending') desc, b.created_at desc;
end;
$$;

-- The three-argument version from business.sql gives way to this one.
drop function if exists public.admin_review_business(uuid, text, text);
create or replace function public.admin_review_business(p_business uuid, p_decision text, p_note text default null, p_checks text[] default null)
returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  b       public.businesses;
  missing text[];
  unticked text[];
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
  if b.owner_id = auth.uid() then
    raise exception 'An admin cannot review their own business' using errcode = '42501';
  end if;
  if p_decision in ('reject', 'suspend') and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Tell the business why, so they can fix it' using errcode = '22023';
  end if;
  missing := public.business_kyc_missing(b);
  if p_decision = 'verify' and cardinality(missing) > 0 then
    raise exception 'Not complete yet: %', array_to_string(missing, ', ') using errcode = '22023';
  end if;
  select coalesce(array_agg(c), '{}') into unticked
    from unnest(public.business_required_checks(b)) c
   where not (c = any (coalesce(p_checks, '{}')));
  if p_decision = 'verify' and cardinality(unticked) > 0 then
    raise exception 'Tick every check before verifying. Not ticked: %', array_to_string(unticked, ', ') using errcode = '22023';
  end if;

  perform set_config('waggle.admin_step', 'on', true);
  update public.businesses
     set status = case p_decision when 'verify' then 'verified' when 'reject' then 'rejected' else 'suspended' end,
         verified_at = case when p_decision = 'verify' then now() else verified_at end,
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = b.id
  returning * into b;
  perform set_config('waggle.admin_step', 'off', true);

  insert into public.business_review_log (business_id, admin_id, decision, checks, note)
  values (b.id, auth.uid(), p_decision, coalesce(p_checks, '{}'), nullif(btrim(coalesce(p_note, '')), ''));

  -- The Rs 999 set-up fee, once, when a business is first verified.
  if p_decision = 'verify' and not exists (select 1 from public.business_charges where business_id = b.id and kind = 'setup') then
    insert into public.business_charges (business_id, kind, amount_paise, description)
    values (b.id, 'setup', 99900, 'Waggle Business set-up');
  end if;
  return b;
end;
$$;

revoke all on function public.admin_business_queue() from public, anon;
revoke all on function public.admin_review_business(uuid, text, text, text[]) from public, anon;
grant execute on function public.admin_business_queue() to authenticated;
grant execute on function public.admin_review_business(uuid, text, text, text[]) to authenticated;

-- A lapsed licence stops new deliveries, whichever door they come in by.
create or replace function public.guard_job_licence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.businesses;
begin
  if new.business_id is null then
    return new;
  end if;
  select * into b from public.businesses where id = new.business_id;
  if not public.business_licence_ok(b) then
    raise exception 'Your % licence has expired. Renew it in Owner & papers to send deliveries again.',
      case public.kind_licence(b.kind) when 'drug' then 'drug' else 'FSSAI' end using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_job_licence on public.jobs;
create trigger trg_guard_job_licence
  before insert on public.jobs
  for each row execute function public.guard_job_licence();
revoke all on function public.guard_job_licence() from public, anon, authenticated;


-- ============================================================================ catalog photos

-- Product photos are for everyone to see, so the bucket is public to read.
-- Writing is each owner's own folder only, and an item may point only at its
-- owner's photos.
alter table public.catalog_items add column if not exists photo_path text check (photo_path is null or length(photo_path) <= 200);

-- What a customer needs to choose well. Food: veg / non-veg / egg, how much
-- ("2 pcs", "250 g", "serves 2"), spice, ingredients and allergens. Shops:
-- MRP beside the price (never below it), brand, and stock when the shop counts
-- it. Tags are the shop's own claims; bestsellers are counted from real orders.
alter table public.catalog_items
  add column if not exists diet           text,
  add column if not exists quantity_label text,
  add column if not exists spice          smallint,
  add column if not exists tags           text[] not null default '{}',
  add column if not exists mrp_paise      integer,
  add column if not exists brand          text,
  add column if not exists stock          integer,
  add column if not exists ingredients    text,
  add column if not exists allergens      text;

do $$
declare
  c record;
begin
  for c in select * from (values
    ('catalog_items_diet_check',      $c$diet is null or diet in ('veg', 'non_veg', 'egg')$c$),
    ('catalog_items_quantity_check',  $c$quantity_label is null or length(btrim(quantity_label)) between 1 and 40$c$),
    ('catalog_items_spice_check',     $c$spice is null or spice between 0 and 3$c$),
    ('catalog_items_tags_check',      $c$tags <@ array['bestseller', 'chefs_special', 'new']::text[] and cardinality(tags) <= 3$c$),
    ('catalog_items_mrp_check',       $c$mrp_paise is null or (mrp_paise >= price_paise and mrp_paise <= 10000000)$c$),
    ('catalog_items_brand_check',     $c$brand is null or length(btrim(brand)) between 1 and 40$c$),
    ('catalog_items_stock_check',     $c$stock is null or stock between 0 and 100000$c$),
    ('catalog_items_ingredients_check', $c$ingredients is null or length(ingredients) <= 300$c$),
    ('catalog_items_allergens_check', $c$allergens is null or length(allergens) <= 120$c$)
  ) as t(name, expr) loop
    execute format('alter table public.catalog_items drop constraint if exists %I', c.name);
    execute format('alter table public.catalog_items add constraint %I check (%s)', c.name, c.expr);
  end loop;
end
$$;

-- Choices on an item: a required "Size" with Half and Full, optional add-ons,
-- and so on. Each group: a name, whether a choice is required, how many may be
-- picked, and up to 15 choices, each a name and what it adds to the price.
--   [{"name": "Size", "required": true, "max": 1,
--     "choices": [{"name": "Half", "price_paise": 0}, {"name": "Full", "price_paise": 6000}]}]
create or replace function public.valid_item_options(o jsonb)
returns boolean
language sql
immutable
as $$
  select o is null or (
    jsonb_typeof(o) = 'array' and jsonb_array_length(o) <= 5
    and not exists (
      select 1 from jsonb_array_elements(o) g
       where jsonb_typeof(g) <> 'object'
          or length(coalesce(g->>'name', '')) not between 1 and 30
          or jsonb_typeof(coalesce(g->'required', 'false'::jsonb)) <> 'boolean'
          or jsonb_typeof(coalesce(g->'max', '1'::jsonb)) <> 'number'
          or coalesce((g->>'max')::numeric, 1) not between 1 and 15
          or jsonb_typeof(g->'choices') is distinct from 'array'
          or jsonb_array_length(g->'choices') not between 1 and 15
          or exists (
               select 1 from jsonb_array_elements(g->'choices') c
                where jsonb_typeof(c) <> 'object'
                   or length(coalesce(c->>'name', '')) not between 1 and 40
                   or jsonb_typeof(c->'price_paise') is distinct from 'number'
                   or (c->>'price_paise')::numeric not between 0 and 500000
                   or (c->>'price_paise')::numeric <> round((c->>'price_paise')::numeric))));
$$;

alter table public.catalog_items add column if not exists options jsonb;
alter table public.catalog_items drop constraint if exists catalog_items_options_check;
alter table public.catalog_items add constraint catalog_items_options_check check (public.valid_item_options(options));

-- One line of a basket, priced from the catalog: the item's price plus each
-- chosen option's, every group's rules checked. The customer sends only which
-- choices they picked, as [group index, choice index] pairs.
create or replace function public._price_line(it public.catalog_items, p_sel jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  groups jsonb := coalesce(it.options, '[]'::jsonb);
  sel    jsonb := coalesce(p_sel, '[]'::jsonb);
  unit   integer := it.price_paise;
  chosen jsonb := '[]'::jsonb;
  g      integer;
  c      integer;
  picks  integer;
  ch     jsonb;
  s      jsonb;
begin
  if jsonb_typeof(sel) <> 'array' or jsonb_array_length(sel) > 30 then
    raise exception 'Choose the options for % again', it.name using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(sel)) <> (select count(distinct x::text) from jsonb_array_elements(sel) x) then
    raise exception 'Each option can be picked once' using errcode = '22023';
  end if;
  for s in select value from jsonb_array_elements(sel) loop
    if jsonb_typeof(s) <> 'array' or jsonb_array_length(s) <> 2 then
      raise exception 'Choose the options for % again', it.name using errcode = '22023';
    end if;
    g := (s->>0)::int;
    c := (s->>1)::int;
    ch := case when g >= 0 and c >= 0 then groups->g->'choices'->c end;
    if ch is null then
      raise exception 'An option on % is no longer offered', it.name using errcode = '22023';
    end if;
    unit := unit + (ch->>'price_paise')::int;
    chosen := chosen || jsonb_build_array(jsonb_build_object('group', groups->g->>'name', 'choice', ch->>'name', 'price_paise', (ch->>'price_paise')::int));
  end loop;
  for g in 0 .. jsonb_array_length(groups) - 1 loop
    select count(*) into picks from jsonb_array_elements(sel) x where (x->>0)::int = g;
    if coalesce((groups->g->>'required')::boolean, false) and picks = 0 then
      raise exception 'Pick a % for %', lower(groups->g->>'name'), it.name using errcode = '22023';
    end if;
    if picks > coalesce((groups->g->>'max')::int, 1) then
      raise exception 'Pick at most % in % for %', coalesce((groups->g->>'max')::int, 1), groups->g->>'name', it.name using errcode = '22023';
    end if;
  end loop;
  return jsonb_build_object('unit_paise', unit, 'chosen', chosen);
end;
$$;

revoke all on function public._price_line(public.catalog_items, jsonb) from public, anon, authenticated;

-- How long the shop usually takes to have an order ready.
alter table public.businesses add column if not exists prep_minutes smallint;
alter table public.businesses drop constraint if exists businesses_prep_minutes_check;
alter table public.businesses add constraint businesses_prep_minutes_check check (prep_minutes is null or prep_minutes between 5 and 120);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('catalog-photos', 'catalog-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "catalog photos upload own" on storage.objects;
create policy "catalog photos upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'catalog-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "catalog photos replace own" on storage.objects;
create policy "catalog photos replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'catalog-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'catalog-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "catalog photos delete own" on storage.objects;
create policy "catalog photos delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'catalog-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.guard_catalog_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if new.photo_path is null then
    return new;
  end if;
  select owner_id into owner from public.businesses where id = new.business_id;
  if left(new.photo_path, 37) <> owner::text || '/' or position('..' in new.photo_path) > 0 then
    raise exception 'Photos must be uploaded from this shop''s account' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_catalog_photo on public.catalog_items;
create trigger trg_guard_catalog_photo
  before insert or update of photo_path on public.catalog_items
  for each row execute function public.guard_catalog_photo();
revoke all on function public.guard_catalog_photo() from public, anon, authenticated;


-- ============================================================================ Gigzen's own details

-- One row, edited by a founder in the SQL editor. Invoices copy it at the moment
-- they are issued. Until gstin is filled in, invoices are bills of supply with
-- no GST on them; upi_id is where businesses pay.
--   update public.company_settings set legal_name = 'Gigzen Private Limited', gstin = '21XXXXX0000X1Z5',
--          pan = 'XXXXX0000X', address = '...', upi_id = 'gigzen@bank';
create table if not exists public.company_settings (
  id            boolean primary key default true check (id),
  legal_name    text not null default 'Gigzen',
  address       text not null default 'Bhubaneswar, Odisha',
  state_code    text not null default '21',
  gstin         text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan           text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  upi_id        text check (upi_id is null or upi_id ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$'),
  -- 998599: other support services. The CA confirms the code before the first invoice.
  sac           text not null default '998599',
  support_email text
);

insert into public.company_settings (id) values (true) on conflict (id) do nothing;

alter table public.company_settings enable row level security;

drop policy if exists "company details readable" on public.company_settings;
create policy "company details readable" on public.company_settings
  for select to authenticated using (true);


-- ============================================================================ invoices

create table if not exists public.invoice_counters (
  fy          text primary key,
  last_number integer not null default 0
);
alter table public.invoice_counters enable row level security;   -- no policies: the database numbers invoices

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  number        text not null unique check (length(number) <= 16),   -- the GST limit
  period        date not null,
  issued_at     timestamptz not null default now(),
  tax_mode      text not null check (tax_mode in ('gst', 'unregistered')),
  taxable_paise integer not null,
  cgst_paise    integer not null default 0,
  sgst_paise    integer not null default 0,
  igst_paise    integer not null default 0,
  total_paise   integer not null,
  supplier      jsonb not null,
  recipient     jsonb not null,
  lines         jsonb not null,
  status        text not null default 'due' check (status in ('due', 'paid')),
  unique (business_id, period)
);

create index if not exists idx_invoices_business on public.invoices (business_id, period desc);

alter table public.invoices enable row level security;

drop policy if exists "invoices for their business" on public.invoices;
create policy "invoices for their business" on public.invoices
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.businesses b where b.id = invoices.business_id and b.owner_id = auth.uid()));

alter table public.business_charges add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

-- The Indian financial year an instant falls in: 2026-27 runs April to March.
create or replace function public.fy_of(p_at timestamptz)
returns text
language sql
immutable
as $$
  select case when extract(month from p_at at time zone 'Asia/Kolkata') >= 4
              then extract(year from p_at at time zone 'Asia/Kolkata')::int::text || '-' || right((extract(year from p_at at time zone 'Asia/Kolkata')::int + 1)::text, 2)
              else (extract(year from p_at at time zone 'Asia/Kolkata')::int - 1)::text || '-' || right(extract(year from p_at at time zone 'Asia/Kolkata')::int::text, 2)
         end;
$$;

-- One month's charges for one business, as a numbered invoice. Prices include
-- GST, so the tax is taken out of the total, not added to it.
create or replace function public._issue_invoice(p_business uuid, p_period date)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  b       public.businesses;
  co      public.company_settings;
  inv     public.invoices;
  v_total   integer;
  v_taxable integer;
  v_tax     integer;
  v_n       integer;
  v_fy      text;
  v_intra   boolean;
  v_lines   jsonb;
begin
  select * into b from public.businesses where id = p_business;
  select * into co from public.company_settings where id;

  select coalesce(sum(amount_paise), 0)::int into v_total
    from public.business_charges
   where business_id = b.id and period = p_period and invoice_id is null and status <> 'waived';
  if v_total = 0 then
    return null;
  end if;

  select jsonb_agg(l order by (l->>'ord')::int, l->>'description') into v_lines from (
    select jsonb_build_object('ord', case kind when 'setup' then 1 else 2 end, 'description', description,
                              'quantity', 1, 'rate_paise', amount_paise, 'amount_paise', amount_paise) as l
      from public.business_charges
     where business_id = b.id and period = p_period and invoice_id is null and status <> 'waived' and kind in ('setup', 'plan')
    union all
    select jsonb_build_object('ord', 3, 'description', 'Delivery routing fee', 'quantity', count(*),
                              'rate_paise', amount_paise, 'amount_paise', sum(amount_paise))
      from public.business_charges
     where business_id = b.id and period = p_period and invoice_id is null and status <> 'waived' and kind = 'routing'
     group by amount_paise
  ) s;

  if co.gstin is not null then
    v_taxable := round(v_total / 1.18);
    v_tax := v_total - v_taxable;
    v_intra := coalesce(b.state_code, left(b.gstin, 2), co.state_code) = co.state_code;
  else
    v_taxable := v_total;
    v_tax := 0;
    v_intra := true;
  end if;

  v_fy := public.fy_of(now());
  insert into public.invoice_counters (fy, last_number) values (v_fy, 1)
  on conflict (fy) do update set last_number = public.invoice_counters.last_number + 1
  returning last_number into v_n;

  insert into public.invoices (business_id, number, period, tax_mode, taxable_paise, cgst_paise, sgst_paise, igst_paise,
                               total_paise, supplier, recipient, lines, status)
  values (b.id,
          'GZ/' || v_fy || '/' || lpad(v_n::text, 5, '0'),
          p_period,
          case when co.gstin is null then 'unregistered' else 'gst' end,
          v_taxable,
          case when v_intra then v_tax / 2 else 0 end,
          case when v_intra then v_tax - v_tax / 2 else 0 end,
          case when v_intra then 0 else v_tax end,
          v_total,
          jsonb_build_object('name', co.legal_name, 'address', co.address, 'gstin', co.gstin, 'pan', co.pan,
                             'state_code', co.state_code, 'sac', co.sac, 'email', co.support_email),
          jsonb_build_object('name', b.name, 'owner', b.owner_name, 'address', b.address, 'gstin', b.gstin,
                             'pan', b.pan, 'state_code', coalesce(b.state_code, left(b.gstin, 2))),
          v_lines,
          case when exists (select 1 from public.business_charges where business_id = b.id and period = p_period
                              and invoice_id is null and status = 'due') then 'due' else 'paid' end)
  returning * into inv;

  update public.business_charges set invoice_id = inv.id
   where business_id = b.id and period = p_period and invoice_id is null and status <> 'waived';
  return inv;
end;
$$;

revoke all on function public._issue_invoice(uuid, date) from public, anon, authenticated;

-- Month end: an invoice for every business that owes something for the month
-- just finished, and the new month's plan fee for every verified business on a
-- paid plan. Safe to run twice: invoices are one per business per month, and a
-- plan fee is billed once per month. Every run is logged.
create table if not exists public.billing_runs (
  period       date primary key,
  ran_at       timestamptz not null default now(),
  invoices     integer not null default 0,
  plan_charges integer not null default 0,
  ran_by       uuid references public.profiles(id) on delete set null   -- null: the monthly schedule
);
alter table public.billing_runs enable row level security;
drop policy if exists "billing runs for admins" on public.billing_runs;
create policy "billing runs for admins" on public.billing_runs
  for select to authenticated using (public.is_admin());

create or replace function public._month_end(p_period date, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month   date := date_trunc('month', p_period)::date;
  v_next    date := (date_trunc('month', p_period) + interval '1 month')::date;
  issued    int := 0;
  billed    int := 0;
  r         record;
begin
  if v_month >= date_trunc('month', now() at time zone 'Asia/Kolkata')::date then
    raise exception 'Close a month only after it has ended' using errcode = '22023';
  end if;

  for r in select distinct business_id from public.business_charges
            where period = v_month and invoice_id is null and status <> 'waived' loop
    if public._issue_invoice(r.business_id, v_month) is not null then
      issued := issued + 1;
    end if;
  end loop;

  for r in select b.id, b.plan from public.businesses b
            where b.status = 'verified' and public.plan_monthly_paise(b.plan) > 0
              and not exists (select 1 from public.business_charges c
                               where c.business_id = b.id and c.kind = 'plan' and c.period = v_next) loop
    insert into public.business_charges (business_id, kind, amount_paise, description, period)
    values (r.id, 'plan', public.plan_monthly_paise(r.plan), initcap(r.plan) || ' plan, ' || to_char(v_next, 'FMMonth YYYY'), v_next);
    billed := billed + 1;
  end loop;

  insert into public.billing_runs (period, ran_at, invoices, plan_charges, ran_by)
  values (v_month, now(), issued, billed, p_by)
  on conflict (period) do update
     set ran_at = now(), invoices = public.billing_runs.invoices + excluded.invoices,
         plan_charges = public.billing_runs.plan_charges + excluded.plan_charges, ran_by = excluded.ran_by;

  return jsonb_build_object('invoices', issued, 'plan_charges', billed, 'period', v_month);
end;
$$;

revoke all on function public._month_end(date, uuid) from public, anon, authenticated;

create or replace function public.admin_month_end(p_period date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return public._month_end(p_period, auth.uid());
end;
$$;

-- What the schedule runs: the month that has just ended in India.
create or replace function public._month_end_auto()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public._month_end((date_trunc('month', now() at time zone 'Asia/Kolkata') - interval '1 month')::date, null);
$$;

revoke all on function public._month_end_auto() from public, anon, authenticated;

-- On the 1st of every month at 00:05 UTC (05:35 in India). Wrapped: pg_cron is
-- not on every plan, and this must never take the rest of the file down.
do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('waggle-month-end');
  exception when others then null;
  end;
  perform cron.schedule('waggle-month-end', '5 0 1 * *', $job$ select public._month_end_auto(); $job$);
exception when others then
  raise notice 'pg_cron unavailable (%). Month end stays on the admin button.', sqlerrm;
end $$;

revoke all on function public.admin_month_end(date) from public, anon;
grant execute on function public.admin_month_end(date) to authenticated;


-- ============================================================================ payments

-- A business pays Gigzen by UPI and reports the transfer's UTR. An admin
-- matches it against the bank statement and confirms it; the oldest charges
-- are then marked paid. A UTR can be reported once, by anyone.
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  invoice_id   uuid references public.invoices(id) on delete set null,
  amount_paise integer not null check (amount_paise between 100 and 100000000),
  utr          text not null unique check (utr ~ '^[0-9A-Z]{10,22}$'),
  status       text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected')),
  review_note  text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);

create index if not exists idx_payments_business on public.payments (business_id, created_at desc);

alter table public.payments enable row level security;

drop policy if exists "payments for their business" on public.payments;
create policy "payments for their business" on public.payments
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.businesses b where b.id = payments.business_id and b.owner_id = auth.uid()));

create or replace function public.submit_payment(p_amount_paise integer, p_utr text, p_invoice uuid default null)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  b   public.businesses;
  v_utr text := upper(regexp_replace(coalesce(p_utr, ''), '\s', '', 'g'));
  pay public.payments;
begin
  select * into b from public.businesses where owner_id = auth.uid();
  if b.id is null then
    raise exception 'Register your business first' using errcode = '42501';
  end if;
  if p_amount_paise is null or p_amount_paise < 100 then
    raise exception 'Enter the amount you paid' using errcode = '22023';
  end if;
  if v_utr !~ '^[0-9A-Z]{10,22}$' then
    raise exception 'The UTR is the 12-digit reference in your UPI app''s payment details' using errcode = '22023';
  end if;
  if p_invoice is not null and not exists (select 1 from public.invoices where id = p_invoice and business_id = b.id) then
    raise exception 'That invoice is not yours' using errcode = '42501';
  end if;
  if (select count(*) from public.payments where business_id = b.id and status = 'submitted') >= 5 then
    raise exception 'Five payments are already waiting to be confirmed' using errcode = '54000';
  end if;
  if exists (select 1 from public.payments where payments.utr = v_utr) then
    raise exception 'This UTR has already been reported' using errcode = '23505';
  end if;
  insert into public.payments (business_id, invoice_id, amount_paise, utr)
  values (b.id, p_invoice, p_amount_paise, v_utr)
  returning * into pay;
  return pay;
end;
$$;

create or replace function public.admin_payment_queue()
returns setof jsonb
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
    select to_jsonb(p) || jsonb_build_object(
             'business_name', b.name,
             'invoice_number', i.number,
             'due_paise', (select coalesce(sum(amount_paise), 0) from public.business_charges c where c.business_id = b.id and c.status = 'due'))
      from public.payments p
      join public.businesses b on b.id = p.business_id
      left join public.invoices i on i.id = p.invoice_id
     order by (p.status = 'submitted') desc, p.created_at desc
     limit 200;
end;
$$;

create or replace function public.admin_review_payment(p_payment uuid, p_decision text, p_note text default null)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  pay  public.payments;
  left_paise integer;
  ch   record;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select * into pay from public.payments where id = p_payment for update;
  if pay.id is null or pay.status <> 'submitted' then
    raise exception 'This payment is not waiting for review' using errcode = '22023';
  end if;
  if p_decision not in ('confirm', 'reject') then
    raise exception 'Decide confirm or reject' using errcode = '22023';
  end if;
  if p_decision = 'reject' and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Tell the business why' using errcode = '22023';
  end if;

  update public.payments
     set status = case p_decision when 'confirm' then 'confirmed' else 'rejected' end,
         review_note = nullif(btrim(coalesce(p_note, '')), ''), reviewed_at = now()
   where id = pay.id
  returning * into pay;

  if p_decision = 'confirm' then
    -- The invoice named first, then the oldest charges, while the money lasts.
    left_paise := pay.amount_paise;
    for ch in select id, amount_paise from public.business_charges
              where business_id = pay.business_id and status = 'due'
              order by (invoice_id is not distinct from pay.invoice_id and pay.invoice_id is not null) desc, created_at
              for update loop
      exit when ch.amount_paise > left_paise;
      update public.business_charges set status = 'paid' where id = ch.id;
      left_paise := left_paise - ch.amount_paise;
    end loop;
    update public.invoices i set status = 'paid'
     where i.business_id = pay.business_id and i.status = 'due'
       and not exists (select 1 from public.business_charges c where c.invoice_id = i.id and c.status = 'due');
  end if;
  return pay;
end;
$$;

revoke all on function public.submit_payment(integer, text, uuid) from public, anon;
revoke all on function public.admin_payment_queue() from public, anon;
revoke all on function public.admin_review_payment(uuid, text, text) from public, anon;
grant execute on function public.submit_payment(integer, text, uuid) to authenticated;
grant execute on function public.admin_payment_queue() to authenticated;
grant execute on function public.admin_review_payment(uuid, text, text) to authenticated;


-- ============================================================================ orders from customers

-- The shop's own link (waggle.../shop/<id>) takes orders from anyone, with no
-- account, until the Waggle app opens in April 2027. The customer pays the shop
-- on delivery. Every order is readable only by the shop and Gigzen's admins;
-- the customer follows theirs with a private tracking token.
create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  code           text not null,
  track_token    text not null unique,
  customer_name  text not null check (length(btrim(customer_name)) between 2 and 60),
  customer_phone text not null check (customer_phone ~ '^\+91[6-9][0-9]{9}$'),
  area           text not null check (length(btrim(area)) between 2 and 60),
  address        text not null check (length(btrim(address)) between 5 and 200),
  lat            double precision not null check (lat between -90 and 90),
  lng            double precision not null check (lng between -180 and 180),
  note           text check (note is null or length(note) <= 300),
  items          jsonb not null,
  subtotal_paise integer not null check (subtotal_paise >= 0),
  delivery_paise integer not null check (delivery_paise >= 0),
  total_paise    integer not null check (total_paise >= 0),
  payment        text not null default 'on_delivery' check (payment in ('on_delivery')),
  status         text not null default 'placed'
                 check (status in ('placed', 'accepted', 'rejected', 'dispatched', 'delivered', 'cancelled')),
  reason         text check (reason is null or length(reason) <= 200),
  job_id         uuid unique references public.jobs(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, code)
);

-- When each step happened, for the customer's timeline and the shop's reports.
alter table public.orders add column if not exists accepted_at   timestamptz;
alter table public.orders add column if not exists dispatched_at timestamptz;
alter table public.orders add column if not exists delivered_at  timestamptz;
alter table public.orders add column if not exists closed_at     timestamptz;

alter table public.orders add column if not exists customer_id uuid references public.profiles(id) on delete set null;
alter table public.orders add column if not exists discount_paise integer not null default 0 check (discount_paise >= 0);
alter table public.orders add column if not exists coupon_code text;
-- For later: between 30 minutes and 7 days ahead. The shop sees it at once.
alter table public.orders add column if not exists scheduled_for timestamptz;
create index if not exists idx_orders_customer on public.orders (customer_id, created_at desc);
create index if not exists idx_orders_business on public.orders (business_id, created_at desc);
create index if not exists idx_orders_phone on public.orders (customer_phone, created_at desc);

alter table public.orders enable row level security;

drop policy if exists "orders for their shop" on public.orders;
create policy "orders for their shop" on public.orders
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.businesses b where b.id = orders.business_id and b.owner_id = auth.uid()));

-- New orders reach the shop's screen the moment they are placed.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end
$$;

-- A customer's stars for a delivered order, once; and problems they report.
-- The shop and Gigzen's admins read both.
create table if not exists public.order_reviews (
  order_id   uuid primary key references public.orders(id) on delete cascade,
  stars      integer not null check (stars between 1 and 5),
  comment    text check (comment is null or length(comment) <= 300),
  created_at timestamptz not null default now()
);

create table if not exists public.order_issues (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  kind       text not null check (kind in ('late', 'missing_item', 'wrong_item', 'damaged', 'rider', 'payment', 'other')),
  details    text check (details is null or length(details) <= 500),
  status     text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);

create index if not exists idx_order_issues on public.order_issues (order_id);
alter table public.order_reviews enable row level security;
alter table public.order_issues enable row level security;

drop policy if exists "reviews for their shop" on public.order_reviews;
create policy "reviews for their shop" on public.order_reviews
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.orders o join public.businesses b on b.id = o.business_id
     where o.id = order_reviews.order_id and b.owner_id = auth.uid()));

drop policy if exists "issues for their shop" on public.order_issues;
create policy "issues for their shop" on public.order_issues
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.orders o join public.businesses b on b.id = o.business_id
     where o.id = order_issues.order_id and b.owner_id = auth.uid()));

-- A customer's photo on their review, and the shop's public reply.
alter table public.order_reviews add column if not exists photo_path text check (photo_path is null or length(photo_path) <= 200);
alter table public.order_reviews add column if not exists reply text check (reply is null or length(reply) <= 300);
alter table public.order_reviews add column if not exists replied_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Only signed-in customers attach photos, each into their own folder.
drop policy if exists "review photos upload own" on storage.objects;
create policy "review photos upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- A shop's own offers. It pays for them: the discount comes off what the
-- customer pays the shop. The database decides who qualifies.
create table if not exists public.coupons (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  code               text not null check (code ~ '^[A-Z0-9]{3,15}$'),
  title              text not null check (length(btrim(title)) between 3 and 60),
  kind               text not null check (kind in ('percent', 'flat')),
  value              integer not null check (value > 0),
  min_order_paise    integer not null default 0 check (min_order_paise between 0 and 10000000),
  max_discount_paise integer check (max_discount_paise is null or max_discount_paise > 0),
  per_phone_limit    integer not null default 1 check (per_phone_limit between 1 and 50),
  usage_limit        integer check (usage_limit is null or usage_limit > 0),
  first_order_only   boolean not null default false,
  starts_at          timestamptz not null default now(),
  ends_at            timestamptz,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (business_id, code),
  check (kind <> 'percent' or value between 1 and 90),
  check (kind <> 'flat' or value <= 1000000),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.coupon_redemptions (
  coupon_id  uuid not null references public.coupons(id) on delete cascade,
  order_id   uuid not null unique references public.orders(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_coupon_redemptions on public.coupon_redemptions (coupon_id);

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

drop policy if exists "coupons for their shop" on public.coupons;
create policy "coupons for their shop" on public.coupons
  for all to authenticated
  using (public.is_admin() or exists (select 1 from public.businesses b where b.id = coupons.business_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.businesses b where b.id = coupons.business_id and b.owner_id = auth.uid() and b.status = 'verified'));

drop policy if exists "redemptions for their shop" on public.coupon_redemptions;
create policy "redemptions for their shop" on public.coupon_redemptions
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.coupons c join public.businesses b on b.id = c.business_id
     where c.id = coupon_redemptions.coupon_id and b.owner_id = auth.uid()));

-- Uses that count: orders not declined or cancelled.
create or replace function public.coupon_used(p_coupon uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.coupon_redemptions r join public.orders o on o.id = r.order_id
   where r.coupon_id = p_coupon and o.status not in ('rejected', 'cancelled');
$$;

revoke all on function public.coupon_used(uuid) from public, anon;
grant execute on function public.coupon_used(uuid) to authenticated;

-- What a customer sees on the shop's link: the shop and what it sells, nothing more.
create or replace function public.public_shop(p_business uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', b.id, 'name', b.name, 'kind', b.kind, 'address', b.address, 'phone', b.phone,
           'lat', b.lat, 'lng', b.lng, 'open', b.shop_open, 'delivery_paise', b.delivery_charge_paise,
           'prep_minutes', b.prep_minutes,
           -- The shop's offers a customer could use now.
           'offers', coalesce((
             select jsonb_agg(jsonb_build_object('code', c.code, 'title', c.title, 'kind', c.kind, 'value', c.value,
                                                 'min_order_paise', c.min_order_paise, 'max_discount_paise', c.max_discount_paise,
                                                 'first_order_only', c.first_order_only) order by c.created_at)
               from public.coupons c
              where c.business_id = b.id and c.active and now() >= c.starts_at and (c.ends_at is null or now() < c.ends_at)
                and (c.usage_limit is null or public.coupon_used(c.id) < c.usage_limit)), '[]'::jsonb),
           -- Recent reviews with something to read or see: a first name, never a full name or number.
           'reviews', coalesce((
             select jsonb_agg(x order by (x->>'at') desc) from (
               select jsonb_build_object('stars', r.stars, 'comment', r.comment, 'photo', r.photo_path, 'reply', r.reply,
                                         'name', split_part(btrim(o.customer_name), ' ', 1), 'at', r.created_at) as x
                 from public.order_reviews r join public.orders o on o.id = r.order_id
                where o.business_id = b.id and (r.comment is not null or r.photo_path is not null)
                order by r.created_at desc limit 12) s), '[]'::jsonb),
           'rating', (select round(avg(r.stars)::numeric, 1) from public.order_reviews r join public.orders o on o.id = r.order_id where o.business_id = b.id),
           'ratings', (select count(*) from public.order_reviews r join public.orders o on o.id = r.order_id where o.business_id = b.id),
           'items', coalesce((
             select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'description', i.description,
                                                 'category', i.category, 'price_paise', i.price_paise, 'photo', i.photo_path,
                                                 'diet', i.diet, 'quantity', i.quantity_label, 'spice', i.spice, 'tags', to_jsonb(i.tags),
                                                 'mrp_paise', i.mrp_paise, 'brand', i.brand, 'ingredients', i.ingredients, 'allergens', i.allergens,
                                                 'stock', i.stock, 'sold_out', coalesce(i.stock = 0, false), 'options', i.options,
                                                 -- Delivered in the last 30 days: the real bestsellers.
                                                 'sold_30d', (select coalesce(sum((l->>'qty')::int), 0)
                                                                from public.orders o, jsonb_array_elements(o.items) l
                                                               where o.business_id = b.id and o.status = 'delivered'
                                                                 and o.created_at > now() - interval '30 days'
                                                                 and l->>'id' = i.id::text))
                              order by i.category nulls last, i.name)
               from public.catalog_items i
              where i.business_id = b.id and i.available), '[]'::jsonb))
    from public.businesses b
   where b.id = p_business and b.status = 'verified' and public.business_licence_ok(b);
$$;

-- A code the customer can read out over the phone: no 0/O, 1/I/L, 2/Z, 5/S, 8/B.
create or replace function public._order_code()
returns text
language sql
volatile
as $$
  select string_agg(substr('ACDEFGHJKMNPQRTUVWXY34679', 1 + floor(random() * 25)::int, 1), '')
    from generate_series(1, 6);
$$;

-- The order a customer places. The customer sends item ids, quantities and
-- which options they picked; names and prices come from the catalog, the
-- coupon's discount from its own rules, and every limit is checked here.
drop function if exists public.place_order(uuid, text, text, text, text, double precision, double precision, text, jsonb);
create or replace function public.place_order(
  p_business      uuid,
  p_name          text,
  p_phone         text,
  p_area          text,
  p_address       text,
  p_lat           double precision,
  p_lng           double precision,
  p_note          text,
  p_items         jsonb,
  p_coupon        text default null,
  p_scheduled_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b          public.businesses;
  phone      text := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  lines      jsonb := '[]'::jsonb;
  per_item   jsonb := '{}'::jsonb;
  subtotal   integer := 0;
  discount   integer := 0;
  cp         public.coupons;
  e          jsonb;
  it         public.catalog_items;
  priced     jsonb;
  qty        integer;
  short_name text;
  short_left int;
  placed     public.orders;
  tries      int := 0;
begin
  select * into b from public.businesses where id = p_business and status = 'verified';
  if b.id is null or not public.business_licence_ok(b) then
    raise exception 'This shop is not taking orders on Waggle right now' using errcode = '22023';
  end if;
  if not b.shop_open then
    raise exception '% is not taking orders right now', b.name using errcode = '22023';
  end if;

  if phone ~ '^[6-9][0-9]{9}$' then
    phone := '+91' || phone;
  elsif phone ~ '^91[6-9][0-9]{9}$' then
    phone := '+' || phone;
  end if;
  if phone !~ '^\+91[6-9][0-9]{9}$' then
    raise exception 'Enter a 10-digit Indian mobile number' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 2 and 60 then
    raise exception 'Enter your name' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_area, ''))) not between 2 and 60 or length(btrim(coalesce(p_address, ''))) not between 5 and 200 then
    raise exception 'Enter your area and full address' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Pin your address on the map' using errcode = '22023';
  end if;
  if public.km_between(b.lat, b.lng, p_lat, p_lng) > 25 then
    raise exception '% delivers within 25 km', b.name using errcode = '22023';
  end if;
  if p_note is not null and length(p_note) > 300 then
    raise exception 'Keep the note under 300 characters' using errcode = '22023';
  end if;
  if p_scheduled_for is not null and (p_scheduled_for < now() + interval '25 minutes' or p_scheduled_for > now() + interval '7 days') then
    raise exception 'Schedule between 30 minutes and 7 days from now' using errcode = '22023';
  end if;

  -- Limits a stranger cannot talk their way past: a few open orders per phone
  -- per shop, ten a day in all, and a ceiling on what one shop is sent unseen.
  if (select count(*) from public.orders where business_id = b.id and customer_phone = phone
        and status in ('placed', 'accepted', 'dispatched')) >= 3 then
    raise exception 'You already have orders waiting at this shop' using errcode = '54000';
  end if;
  if (select count(*) from public.orders where customer_phone = phone and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Ten orders a day is the limit for one number' using errcode = '54000';
  end if;
  if (select count(*) from public.orders where business_id = b.id and status = 'placed') >= 100 then
    raise exception 'This shop has too many orders waiting. Try again soon.' using errcode = '54000';
  end if;

  -- The basket, line by line: the item as the catalog has it, its options priced.
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception 'Add something to your order' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(p_items) loop
    qty := coalesce((e->>'qty')::int, 0);
    if qty not between 1 and 20 then
      raise exception 'Between 1 and 20 of each item' using errcode = '22023';
    end if;
    select * into it from public.catalog_items
     where id = (e->>'id')::uuid and business_id = b.id and available;
    if it.id is null then
      raise exception 'Something in your basket is no longer available' using errcode = '22023';
    end if;
    priced := public._price_line(it, e->'options');
    lines := lines || jsonb_build_array(jsonb_build_object(
      'id', it.id, 'name', it.name, 'qty', qty, 'price_paise', (priced->>'unit_paise')::int,
      'options', priced->'chosen', 'selection', coalesce(e->'options', '[]'::jsonb)));
    subtotal := subtotal + (priced->>'unit_paise')::int * qty;
    per_item := jsonb_set(per_item, array[it.id::text], to_jsonb(coalesce((per_item->>it.id::text)::int, 0) + qty));
  end loop;
  if (select sum(v::int) from jsonb_each_text(per_item) x(k, v)) > 60 then
    raise exception 'That is a lot at once. Split it into two orders.' using errcode = '22023';
  end if;

  -- Stock, where the shop counts it: enough for this basket, taken now under a
  -- lock, and given back if the order is declined or cancelled.
  perform 1 from public.catalog_items where id in (select k::uuid from jsonb_object_keys(per_item) k) and stock is not null for update;
  select i.name, i.stock into short_name, short_left
    from jsonb_each_text(per_item) x(k, v)
    join public.catalog_items i on i.id = x.k::uuid
   where i.stock is not null and i.stock < x.v::int
   limit 1;
  if short_name is not null then
    if short_left = 0 then
      raise exception '% is sold out', short_name using errcode = '22023';
    end if;
    raise exception 'Only % left of %', short_left, short_name using errcode = '22023';
  end if;

  -- The coupon, if any: the shop's own rules, applied here.
  if nullif(btrim(coalesce(p_coupon, '')), '') is not null then
    select * into cp from public.coupons
     where business_id = b.id and code = upper(btrim(p_coupon)) and active
       and now() >= starts_at and (ends_at is null or now() < ends_at)
     for update;
    if cp.id is null then
      raise exception 'That coupon does not work at %', b.name using errcode = '22023';
    end if;
    if subtotal < cp.min_order_paise then
      raise exception 'Add items worth Rs % more to use %', ceil((cp.min_order_paise - subtotal) / 100.0), cp.code using errcode = '22023';
    end if;
    if cp.usage_limit is not null and public.coupon_used(cp.id) >= cp.usage_limit then
      raise exception '% has been fully used', cp.code using errcode = '22023';
    end if;
    if (select count(*) from public.coupon_redemptions r join public.orders o on o.id = r.order_id
         where r.coupon_id = cp.id and o.customer_phone = phone and o.status not in ('rejected', 'cancelled')) >= cp.per_phone_limit then
      raise exception 'You have already used %', cp.code using errcode = '22023';
    end if;
    if cp.first_order_only and exists (select 1 from public.orders where business_id = b.id and customer_phone = phone and status = 'delivered') then
      raise exception '% is for a first order at %', cp.code, b.name using errcode = '22023';
    end if;
    discount := case cp.kind
                  when 'percent' then least(floor(subtotal * cp.value / 100.0)::int, coalesce(cp.max_discount_paise, subtotal))
                  else least(cp.value, subtotal) end;
  end if;

  update public.catalog_items i set stock = i.stock - x.v::int
    from jsonb_each_text(per_item) x(k, v)
   where i.id = x.k::uuid and i.stock is not null;

  loop
    begin
      insert into public.orders (business_id, code, track_token, customer_name, customer_phone, area, address,
                                 lat, lng, note, items, subtotal_paise, delivery_paise, discount_paise, total_paise,
                                 coupon_code, scheduled_for, customer_id)
      values (b.id, public._order_code(), encode(extensions.gen_random_bytes(18), 'hex'), btrim(p_name), phone,
              btrim(p_area), btrim(p_address), p_lat, p_lng, nullif(btrim(coalesce(p_note, '')), ''), lines,
              subtotal, b.delivery_charge_paise, discount, subtotal - discount + b.delivery_charge_paise,
              cp.code, p_scheduled_for, auth.uid())
      returning * into placed;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
  if cp.id is not null then
    insert into public.coupon_redemptions (coupon_id, order_id) values (cp.id, placed.id);
  end if;

  return jsonb_build_object('code', placed.code, 'token', placed.track_token, 'total_paise', placed.total_paise, 'discount_paise', placed.discount_paise);
end;
$$;

-- The customer's view of their order: each step's time, the delivery code to
-- give the worker once it is on its way, and, only while it is on its way to
-- them, who is bringing it and where they are. The rider is a first name, a
-- vehicle and the plate's last four characters: no surname, no phone number.
-- Their position shows only after pickup and only if it is fresh.
create or replace function public.track_order(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'code', o.code, 'status', o.status, 'reason', o.reason, 'items', o.items,
           'subtotal_paise', o.subtotal_paise, 'delivery_paise', o.delivery_paise, 'total_paise', o.total_paise,
           'discount_paise', o.discount_paise, 'coupon_code', o.coupon_code, 'scheduled_for', o.scheduled_for,
           'area', o.area, 'address', o.address, 'lat', o.lat, 'lng', o.lng, 'note', o.note,
           'created_at', o.created_at, 'accepted_at', o.accepted_at, 'dispatched_at', o.dispatched_at,
           'delivered_at', o.delivered_at, 'closed_at', o.closed_at,
           'shop', jsonb_build_object('id', b.id, 'name', b.name, 'phone', b.phone, 'address', b.address,
                                      'lat', b.lat, 'lng', b.lng, 'gstin', b.gstin, 'kind', b.kind),
           'job', case when j.id is null then null else jsonb_build_object(
                    'status', j.status, 'accepted_at', j.accepted_at, 'picked_up_at', j.picked_up_at,
                    'delivered_at', j.delivered_at, 'distance_km', j.distance_km) end,
           'rider', case when j.assigned_to is not null and j.status in ('accepted', 'picked_up', 'completed') then jsonb_build_object(
                    'first_name', split_part(btrim(v.legal_name), ' ', 1),
                    'vehicle', v.vehicle,
                    'plate_last4', nullif(right(regexp_replace(coalesce(v.vehicle_number, ''), '[^A-Za-z0-9]', '', 'g'), 4), '')) end,
           'rider_at', case when j.status = 'picked_up' and wl.updated_at > now() - interval '10 minutes'
                            then jsonb_build_object('lat', wl.lat, 'lng', wl.lng, 'at', wl.updated_at) end,
           'delivery_code', case when o.status = 'dispatched' then c.delivery_code end,
           'review', (select jsonb_build_object('stars', r.stars, 'comment', r.comment, 'photo', r.photo_path, 'reply', r.reply)
                        from public.order_reviews r where r.order_id = o.id),
           'issues', (select count(*) from public.order_issues i where i.order_id = o.id))
    from public.orders o
    join public.businesses b on b.id = o.business_id
    left join public.jobs j on j.id = o.job_id
    left join public.job_codes c on c.job_id = o.job_id
    left join public.worker_verifications v on v.user_id = j.assigned_to
    left join public.worker_locations wl on wl.user_id = j.assigned_to
   where o.track_token = p_token and length(p_token) = 36;
$$;

create or replace function public.cancel_my_order(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where track_token = p_token and length(p_token) = 36 for update;
  if o.id is null then
    return 'not_found';
  end if;
  if o.status <> 'placed' then
    return 'too_late';   -- the shop has started on it; the customer calls the shop
  end if;
  update public.orders set status = 'cancelled', reason = 'Cancelled by the customer', updated_at = now(), closed_at = now() where id = o.id;
  return 'ok';
end;
$$;

-- The shop's side. Each checks the order is this owner's.
create or replace function public._my_order(p_order uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select o2.* into o from public.orders o2 join public.businesses b on b.id = o2.business_id
   where o2.id = p_order and b.owner_id = auth.uid() for update of o2;
  if o.id is null then
    raise exception 'No such order' using errcode = '42501';
  end if;
  return o;
end;
$$;

create or replace function public.respond_order(p_order uuid, p_accept boolean, p_reason text default null)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders := public._my_order(p_order);
begin
  if o.status <> 'placed' then
    raise exception 'This order has already been answered' using errcode = '22023';
  end if;
  if not p_accept and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Tell the customer why' using errcode = '22023';
  end if;
  update public.orders
     set status = case when p_accept then 'accepted' else 'rejected' end,
         reason = case when p_accept then null else left(btrim(p_reason), 200) end,
         accepted_at = case when p_accept then now() end,
         closed_at = case when p_accept then null else now() end,
         updated_at = now()
   where id = o.id
  returning * into o;
  return o;
end;
$$;

-- Send an accepted order with a Waggle worker: a job to the customer's pin.
create or replace function public.dispatch_order(p_order uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  o   public.orders := public._my_order(p_order);
  job public.jobs;
begin
  if o.status <> 'accepted' then
    raise exception 'Accept the order before sending it' using errcode = '22023';
  end if;
  job := public._post_job_core(o.business_id, o.area, o.address, o.lat, o.lng,
                               left('Order ' || o.code || coalesce(': ' || o.note, ''), 300), 'order', o.code);
  update public.orders set status = 'dispatched', job_id = job.id, dispatched_at = now(), updated_at = now() where id = o.id returning * into o;
  return o;
end;
$$;

-- Delivered by the shop's own staff, or picked up at the counter.
create or replace function public.complete_order_self(p_order uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders := public._my_order(p_order);
begin
  if o.status <> 'accepted' then
    raise exception 'Only an accepted order that has not been sent with Waggle' using errcode = '22023';
  end if;
  update public.orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = o.id returning * into o;
  return o;
end;
$$;

create or replace function public.cancel_order(p_order uuid, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders := public._my_order(p_order);
begin
  if o.status not in ('placed', 'accepted') then
    raise exception 'Only an order not yet sent can be cancelled; cancel the delivery first' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Tell the customer why' using errcode = '22023';
  end if;
  update public.orders set status = 'cancelled', reason = left(btrim(p_reason), 200), updated_at = now(), closed_at = now()
   where id = o.id returning * into o;
  return o;
end;
$$;

-- Stock taken by an order goes back on the shelf if the order is declined or cancelled.
create or replace function public.restock_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('rejected', 'cancelled') and old.status not in ('rejected', 'cancelled') then
    update public.catalog_items i set stock = i.stock + (l->>'qty')::int
      from jsonb_array_elements(new.items) l
     where i.id = (l->>'id')::uuid and i.stock is not null;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_restock_order on public.orders;
create trigger trg_restock_order
  after update of status on public.orders
  for each row execute function public.restock_order();
revoke all on function public.restock_order() from public, anon, authenticated;

-- The order follows its delivery: delivered when the worker enters the code,
-- back to "accepted" if the shop cancels the delivery before anyone takes it.
create or replace function public.sync_order_with_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.orders set status = 'delivered', delivered_at = coalesce(new.delivered_at, now()), updated_at = now()
     where job_id = new.id and status = 'dispatched';
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update public.orders set status = 'accepted', job_id = null, dispatched_at = null, updated_at = now() where job_id = new.id and status = 'dispatched';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_order_with_job on public.jobs;
create trigger trg_sync_order_with_job
  after update of status on public.jobs
  for each row when (new.source = 'order')
  execute function public.sync_order_with_job();

drop function if exists public.rate_order(text, integer, text);
create or replace function public.rate_order(p_token text, p_stars integer, p_comment text default null, p_photo text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where track_token = p_token and length(p_token) = 36;
  if o.id is null then
    return 'not_found';
  end if;
  if o.status <> 'delivered' then
    return 'not_yet';
  end if;
  if p_stars is null or p_stars not between 1 and 5 or (p_comment is not null and length(p_comment) > 300) then
    return 'invalid';
  end if;
  -- A photo is the signed-in customer's own upload, and only theirs.
  if p_photo is not null and (auth.uid() is null or left(p_photo, 37) <> auth.uid()::text || '/' or position('..' in p_photo) > 0 or length(p_photo) > 200) then
    return 'invalid';
  end if;
  insert into public.order_reviews (order_id, stars, comment, photo_path)
  values (o.id, p_stars, nullif(btrim(coalesce(p_comment, '')), ''), p_photo)
  on conflict (order_id) do nothing;
  return case when found then 'ok' else 'already' end;
end;
$$;

-- The shop answers a review, in public, once and editable.
create or replace function public.reply_review(p_order uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders := public._my_order(p_order);
begin
  if length(btrim(coalesce(p_reply, ''))) not between 2 and 300 then
    raise exception 'Write a reply of up to 300 characters' using errcode = '22023';
  end if;
  update public.order_reviews set reply = btrim(p_reply), replied_at = now() where order_id = o.id;
  if not found then
    raise exception 'This order has no review yet' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.reply_review(uuid, text) from public, anon;
grant execute on function public.reply_review(uuid, text) to authenticated;

create or replace function public.report_order_problem(p_token text, p_kind text, p_details text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where track_token = p_token and length(p_token) = 36;
  if o.id is null then
    return 'not_found';
  end if;
  if p_kind not in ('late', 'missing_item', 'wrong_item', 'damaged', 'rider', 'payment', 'other')
     or (p_details is not null and length(p_details) > 500) then
    return 'invalid';
  end if;
  if (select count(*) from public.order_issues where order_id = o.id) >= 3 then
    return 'too_many';
  end if;
  insert into public.order_issues (order_id, kind, details) values (o.id, p_kind, nullif(btrim(coalesce(p_details, '')), ''));
  return 'ok';
end;
$$;

grant execute on function public.rate_order(text, integer, text, text) to anon, authenticated;
grant execute on function public.report_order_problem(text, text, text) to anon, authenticated;
revoke all on function public._order_code() from public, anon, authenticated;
revoke all on function public._my_order(uuid) from public, anon, authenticated;
revoke all on function public.sync_order_with_job() from public, anon, authenticated;
grant execute on function public.public_shop(uuid) to anon, authenticated;
grant execute on function public.place_order(uuid, text, text, text, text, double precision, double precision, text, jsonb, text, timestamptz) to anon, authenticated;
grant execute on function public.track_order(text) to anon, authenticated;
grant execute on function public.cancel_my_order(text) to anon, authenticated;
revoke all on function public.respond_order(uuid, boolean, text) from public, anon;
revoke all on function public.dispatch_order(uuid) from public, anon;
revoke all on function public.complete_order_self(uuid) from public, anon;
revoke all on function public.cancel_order(uuid, text) from public, anon;
grant execute on function public.respond_order(uuid, boolean, text) to authenticated;
grant execute on function public.dispatch_order(uuid) to authenticated;
grant execute on function public.complete_order_self(uuid) to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;


-- ============================================================================ reports

-- One period of a business's own numbers, in India's time zone. It reads only
-- the caller's business: there is no argument that names another.
create or replace function public.business_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b      public.businesses;
  since  timestamptz := p_from::timestamp at time zone 'Asia/Kolkata';
  until_ timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
  result jsonb;
begin
  select * into b from public.businesses where owner_id = auth.uid();
  if b.id is null then
    raise exception 'Register your business first' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Pick a period of up to a year' using errcode = '22023';
  end if;

  with j as (
    select * from public.jobs where business_id = b.id and created_at >= since and created_at < until_
  ), o as (
    select * from public.orders where business_id = b.id and created_at >= since and created_at < until_
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'deliveries', (select jsonb_build_object(
        'sent', count(*) filter (where status <> 'cancelled'),
        'delivered', count(*) filter (where status = 'completed'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'in_progress', count(*) filter (where status in ('open', 'accepted', 'picked_up')),
        'avg_accept_min', round((avg(extract(epoch from accepted_at - created_at) / 60) filter (where accepted_at is not null))::numeric, 1),
        'avg_ride_min', round((avg(extract(epoch from delivered_at - picked_up_at) / 60) filter (where delivered_at is not null and picked_up_at is not null))::numeric, 1),
        'fees_paise', coalesce(sum(fee_paise) filter (where status = 'completed'), 0),
        'fares', coalesce(sum(payout) filter (where status = 'completed'), 0),
        'km', coalesce(sum(distance_km) filter (where status = 'completed'), 0),
        'by_source', coalesce((select jsonb_object_agg(source, n) from (select source, count(*) n from j where status <> 'cancelled' group by source) s), '{}'::jsonb))
      from j),
    'orders', (select jsonb_build_object(
        'placed', count(*),
        'delivered', count(*) filter (where status = 'delivered'),
        'rejected', count(*) filter (where status in ('rejected', 'cancelled')),
        'sales_paise', coalesce(sum(total_paise) filter (where status = 'delivered'), 0),
        'avg_order_paise', coalesce(round(avg(total_paise) filter (where status = 'delivered')), 0))
      from o),
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'sent', coalesce(x.sent, 0), 'delivered', coalesce(x.delivered, 0),
                                                          'orders', coalesce(y.orders, 0), 'sales_paise', coalesce(y.sales, 0)) order by d.day), '[]'::jsonb)
      from (select generate_series(p_from, p_to, interval '1 day')::date as day) d
      left join (select (created_at at time zone 'Asia/Kolkata')::date as day,
                        count(*) filter (where status <> 'cancelled') as sent,
                        count(*) filter (where status = 'completed') as delivered
                   from j group by 1) x on x.day = d.day
      left join (select (created_at at time zone 'Asia/Kolkata')::date as day,
                        count(*) as orders, sum(total_paise) filter (where status = 'delivered') as sales
                   from o group by 1) y on y.day = d.day),
    'areas', (select coalesce(jsonb_agg(jsonb_build_object('area', dropoff, 'count', n) order by n desc, dropoff), '[]'::jsonb)
      from (select dropoff, count(*) n from j where status <> 'cancelled' group by dropoff order by n desc, dropoff limit 8) a),
    'top_items', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'sales_paise', sales) order by qty desc, name), '[]'::jsonb)
      from (select l->>'name' as name, sum((l->>'qty')::int) as qty, sum((l->>'qty')::int * (l->>'price_paise')::int) as sales
              from o, jsonb_array_elements(o.items) l
             where o.status = 'delivered'
             group by 1 order by 2 desc, 1 limit 8) t)
  ) into result;
  return result;
end;
$$;

revoke all on function public.business_report(date, date) from public, anon;
grant execute on function public.business_report(date, date) to authenticated;


-- ============================================================================ ads

-- Campaigns are set up and approved now and shown in the Waggle app from its
-- launch; the monthly ad credit in Growth and Pro pays for them first.
create table if not exists public.ad_campaigns (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  name                 text not null check (length(btrim(name)) between 2 and 60),
  headline             text not null check (length(btrim(headline)) between 3 and 60),
  item_id              uuid references public.catalog_items(id) on delete set null,
  monthly_budget_paise integer not null check (monthly_budget_paise between 5000 and 10000000),
  starts_on            date not null default current_date,
  ends_on              date,
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'paused', 'ended')),
  review_note          text,
  created_at           timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create index if not exists idx_ad_campaigns_business on public.ad_campaigns (business_id, created_at desc);

-- What each campaign cost, day by day, written by the Waggle app's ad server.
create table if not exists public.ad_spend (
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  day         date not null,
  impressions integer not null default 0 check (impressions >= 0),
  clicks      integer not null default 0 check (clicks >= 0),
  cost_paise  integer not null default 0 check (cost_paise >= 0),
  primary key (campaign_id, day)
);

alter table public.ad_campaigns enable row level security;
alter table public.ad_spend enable row level security;

drop policy if exists "ads for their business" on public.ad_campaigns;
create policy "ads for their business" on public.ad_campaigns
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.businesses b where b.id = ad_campaigns.business_id and b.owner_id = auth.uid()));

drop policy if exists "ad spend for their business" on public.ad_spend;
create policy "ad spend for their business" on public.ad_spend
  for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.ad_campaigns a join public.businesses b on b.id = a.business_id
     where a.id = ad_spend.campaign_id and b.owner_id = auth.uid()));

-- New or edited, a campaign goes to Gigzen for a look before it can show.
create or replace function public.save_ad_campaign(
  p_id           uuid,
  p_name         text,
  p_headline     text,
  p_item         uuid,
  p_budget_paise integer,
  p_starts_on    date,
  p_ends_on      date
)
returns public.ad_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.businesses;
  a public.ad_campaigns;
begin
  select * into b from public.businesses where owner_id = auth.uid();
  if b.id is null or b.status <> 'verified' then
    raise exception 'Ads open once your business is verified' using errcode = '42501';
  end if;
  if p_item is not null and not exists (select 1 from public.catalog_items where id = p_item and business_id = b.id) then
    raise exception 'That item is not in your catalog' using errcode = '42501';
  end if;
  if p_starts_on is null or p_starts_on < (now() at time zone 'Asia/Kolkata')::date - 1 then
    raise exception 'Start today or later' using errcode = '22023';
  end if;
  if p_id is null then
    if (select count(*) from public.ad_campaigns where business_id = b.id and status in ('pending', 'approved', 'paused')) >= 10 then
      raise exception 'Ten campaigns at a time is the limit' using errcode = '54000';
    end if;
    insert into public.ad_campaigns (business_id, name, headline, item_id, monthly_budget_paise, starts_on, ends_on)
    values (b.id, btrim(p_name), btrim(p_headline), p_item, p_budget_paise, p_starts_on, p_ends_on)
    returning * into a;
  else
    update public.ad_campaigns
       set name = btrim(p_name), headline = btrim(p_headline), item_id = p_item, monthly_budget_paise = p_budget_paise,
           starts_on = p_starts_on, ends_on = p_ends_on, status = 'pending', review_note = null
     where id = p_id and business_id = b.id and status <> 'ended'
    returning * into a;
    if a.id is null then
      raise exception 'No such campaign' using errcode = '42501';
    end if;
  end if;
  return a;
end;
$$;

create or replace function public.set_ad_campaign_state(p_id uuid, p_state text)
returns public.ad_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ad_campaigns;
begin
  select a2.* into a from public.ad_campaigns a2 join public.businesses b on b.id = a2.business_id
   where a2.id = p_id and b.owner_id = auth.uid() for update of a2;
  if a.id is null then
    raise exception 'No such campaign' using errcode = '42501';
  end if;
  if not ((p_state = 'paused' and a.status = 'approved')
          or (p_state = 'approved' and a.status = 'paused')
          or (p_state = 'ended' and a.status <> 'ended')) then
    raise exception 'That change is not possible from here' using errcode = '22023';
  end if;
  update public.ad_campaigns set status = p_state where id = a.id returning * into a;
  return a;
end;
$$;

create or replace function public.admin_ad_queue()
returns setof jsonb
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
    select to_jsonb(a) || jsonb_build_object('business_name', b.name, 'item_name', i.name)
      from public.ad_campaigns a
      join public.businesses b on b.id = a.business_id
      left join public.catalog_items i on i.id = a.item_id
     order by (a.status = 'pending') desc, a.created_at desc
     limit 200;
end;
$$;

create or replace function public.admin_review_ad(p_id uuid, p_approve boolean, p_note text default null)
returns public.ad_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.ad_campaigns;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Tell the business why' using errcode = '22023';
  end if;
  update public.ad_campaigns
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id and status = 'pending'
  returning * into a;
  if a.id is null then
    raise exception 'This campaign is not waiting for review' using errcode = '22023';
  end if;
  return a;
end;
$$;

revoke all on function public.save_ad_campaign(uuid, text, text, uuid, integer, date, date) from public, anon;
revoke all on function public.set_ad_campaign_state(uuid, text) from public, anon;
revoke all on function public.admin_ad_queue() from public, anon;
revoke all on function public.admin_review_ad(uuid, boolean, text) from public, anon;
grant execute on function public.save_ad_campaign(uuid, text, text, uuid, integer, date, date) to authenticated;
grant execute on function public.set_ad_campaign_state(uuid, text) to authenticated;
grant execute on function public.admin_ad_queue() to authenticated;
grant execute on function public.admin_review_ad(uuid, boolean, text) to authenticated;


-- ============================================================================ the delivery API

-- A business's own systems send deliveries with a key. The key is shown once,
-- at creation; the database keeps its SHA-256 and the first characters, so a
-- leaked table gives nobody a working key.
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 2 and 40),
  prefix       text not null,
  key_hash     bytea not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

alter table public.api_keys enable row level security;   -- no policies: read through my_api_keys()

create or replace function public.my_api_keys()
returns table (id uuid, name text, prefix text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.revoked_at
    from public.api_keys k join public.businesses b on b.id = k.business_id
   where b.owner_id = auth.uid()
   order by k.revoked_at nulls first, k.created_at desc;
$$;

create or replace function public.create_api_key(p_name text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  b   public.businesses;
  key text;
begin
  select * into b from public.businesses where owner_id = auth.uid();
  if b.id is null or b.status <> 'verified' then
    raise exception 'API keys open once your business is verified' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 2 and 40 then
    raise exception 'Name the key after the system that will use it' using errcode = '22023';
  end if;
  if (select count(*) from public.api_keys where business_id = b.id and revoked_at is null) >= 5 then
    raise exception 'Five live keys is the limit; revoke one first' using errcode = '54000';
  end if;
  key := 'wgk_live_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_keys (business_id, name, prefix, key_hash)
  values (b.id, btrim(p_name), left(key, 13), extensions.digest(key, 'sha256'));
  return key;
end;
$$;

create or replace function public.revoke_api_key(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.api_keys k set revoked_at = now()
    from public.businesses b
   where k.id = p_id and b.id = k.business_id and b.owner_id = auth.uid() and k.revoked_at is null;
$$;

create or replace function public._api_business(p_key text)
returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.api_keys;
  b public.businesses;
begin
  select * into k from public.api_keys
   where key_hash = extensions.digest(coalesce(p_key, ''), 'sha256') and revoked_at is null;
  if k.id is null then
    raise exception 'Invalid or revoked API key' using errcode = '28000';
  end if;
  select * into b from public.businesses where id = k.business_id;
  if b.status <> 'verified' then
    raise exception 'This business is not verified' using errcode = '42501';
  end if;
  if k.last_used_at is null or k.last_used_at < now() - interval '1 minute' then
    update public.api_keys set last_used_at = now() where id = k.id;
  end if;
  return b;
end;
$$;

create or replace function public._api_job(j public.jobs)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', j.id, 'status', j.status, 'reference', j.external_ref, 'dropoff_area', j.dropoff,
    'distance_km', j.distance_km, 'fare_rupees', j.payout, 'fee_paise', j.fee_paise,
    'created_at', j.created_at, 'accepted_at', j.accepted_at, 'picked_up_at', j.picked_up_at, 'delivered_at', j.delivered_at,
    'pickup_code', c.pickup_code, 'delivery_code', c.delivery_code)
  from (select 1) one left join public.job_codes c on c.job_id = j.id;
$$;

-- POST /rest/v1/rpc/api_create_delivery with the project's public key as
-- `apikey` and the business's key as p_key.
create or replace function public.api_create_delivery(
  p_key             text,
  p_dropoff_area    text,
  p_dropoff_address text,
  p_dropoff_lat     double precision,
  p_dropoff_lng     double precision,
  p_note            text default null,
  p_reference       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b   public.businesses := public._api_business(p_key);
  job public.jobs;
begin
  if (select count(*) from public.jobs where business_id = b.id and source = 'api' and created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Rate limit: 300 deliveries an hour per business' using errcode = '54000';
  end if;
  if p_reference is not null and length(p_reference) > 64 then
    raise exception 'reference is at most 64 characters' using errcode = '22023';
  end if;
  job := public._post_job_core(b.id, p_dropoff_area, p_dropoff_address, p_dropoff_lat, p_dropoff_lng, p_note, 'api', p_reference);
  return public._api_job(job);
end;
$$;

create or replace function public.api_delivery_status(p_key text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.businesses := public._api_business(p_key);
  j public.jobs;
begin
  select * into j from public.jobs where id = p_id and business_id = b.id;
  if j.id is null then
    raise exception 'No such delivery for this business' using errcode = '22023';
  end if;
  return public._api_job(j);
end;
$$;

create or replace function public.api_cancel_delivery(p_key text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.businesses := public._api_business(p_key);
  j public.jobs;
begin
  perform set_config('waggle.job_step', 'on', true);
  update public.jobs set status = 'cancelled', updated_at = now()
   where id = p_id and business_id = b.id and status = 'open' and assigned_to is null
  returning * into j;
  perform set_config('waggle.job_step', 'off', true);
  if j.id is null then
    raise exception 'Only a delivery nobody has taken yet can be cancelled' using errcode = '22023';
  end if;
  return public._api_job(j);
end;
$$;

revoke all on function public._api_business(text) from public, anon, authenticated;
revoke all on function public._api_job(public.jobs) from public, anon, authenticated;
revoke all on function public.my_api_keys() from public, anon;
revoke all on function public.create_api_key(text) from public, anon;
revoke all on function public.revoke_api_key(uuid) from public, anon;
grant execute on function public.my_api_keys() to authenticated;
grant execute on function public.create_api_key(text) to authenticated;
grant execute on function public.revoke_api_key(uuid) to authenticated;
grant execute on function public.api_create_delivery(text, text, text, double precision, double precision, text, text) to anon, authenticated;
grant execute on function public.api_delivery_status(text, uuid) to anon, authenticated;
grant execute on function public.api_cancel_delivery(text, uuid) to anon, authenticated;


-- ============================================================================ the Waggle app: addresses, my orders, discovery

-- A customer's saved places. Each account sees and edits only its own.
create table if not exists public.customer_addresses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  label      text not null check (label in ('home', 'work', 'other')),
  area       text not null check (length(btrim(area)) between 2 and 60),
  address    text not null check (length(btrim(address)) between 5 and 200),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_addresses on public.customer_addresses (user_id, created_at desc);
alter table public.customer_addresses enable row level security;

drop policy if exists "addresses own" on public.customer_addresses;
create policy "addresses own" on public.customer_addresses
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.guard_customer_address()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.customer_addresses where user_id = new.user_id) >= 10 then
    raise exception 'Ten saved addresses is the limit' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_customer_address on public.customer_addresses;
create trigger trg_guard_customer_address
  before insert on public.customer_addresses
  for each row execute function public.guard_customer_address();
revoke all on function public.guard_customer_address() from public, anon, authenticated;

-- The signed-in customer's orders, newest first, with the link to follow each.
create or replace function public.my_orders()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('token', o.track_token, 'code', o.code, 'status', o.status, 'total_paise', o.total_paise,
                            'created_at', o.created_at, 'shop', b.name, 'shop_id', b.id,
                            'items', (select count(*) from jsonb_array_elements(o.items)))
    from public.orders o join public.businesses b on b.id = o.business_id
   where o.customer_id = auth.uid()
   order by o.created_at desc
   limit 100;
$$;

revoke all on function public.my_orders() from public, anon;
grant execute on function public.my_orders() to authenticated;

-- Which segment a shop belongs to in the app: meals under Food, everything else under Shop.
create or replace function public.kind_segment(p_kind text)
returns text
language sql
immutable
as $$
  select case when p_kind in ('restaurant', 'cafe', 'cloud_kitchen', 'bakery') then 'food' else 'shop' end;
$$;

grant execute on function public.kind_segment(text) to anon, authenticated;

-- Shops that deliver to a point: verified, licence in date, within 25 km.
-- Open ones first, then the nearest.
create or replace function public.nearby_shops(p_lat double precision, p_lng double precision, p_segment text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(s.j order by s.open desc, s.km), '[]'::jsonb)
    from (
      select b.shop_open as open,
             public.km_between(b.lat, b.lng, p_lat, p_lng) as km,
             jsonb_build_object(
               'id', b.id, 'name', b.name, 'kind', b.kind, 'segment', public.kind_segment(b.kind), 'address', b.address,
               'open', b.shop_open, 'delivery_paise', b.delivery_charge_paise, 'prep_minutes', b.prep_minutes,
               'km', round(public.km_between(b.lat, b.lng, p_lat, p_lng)::numeric, 1),
               'rating', (select round(avg(r.stars)::numeric, 1) from public.order_reviews r join public.orders o on o.id = r.order_id where o.business_id = b.id),
               'ratings', (select count(*) from public.order_reviews r join public.orders o on o.id = r.order_id where o.business_id = b.id),
               'items', (select count(*) from public.catalog_items i where i.business_id = b.id and i.available),
               'pure_veg', (select coalesce(bool_and(i.diet = 'veg'), false) and count(*) > 0 from public.catalog_items i
                             where i.business_id = b.id and i.available and i.diet is not null),
               'cover', (select i.photo_path from public.catalog_items i where i.business_id = b.id and i.available and i.photo_path is not null
                          order by ('bestseller' = any (i.tags)) desc, i.created_at limit 1),
               'from_paise', (select min(i.price_paise) from public.catalog_items i where i.business_id = b.id and i.available)) as j
        from public.businesses b
       where b.status = 'verified' and public.business_licence_ok(b)
         and p_lat between -90 and 90 and p_lng between -180 and 180
         and public.km_between(b.lat, b.lng, p_lat, p_lng) <= 25
         and (p_segment is null or public.kind_segment(b.kind) = p_segment)
       order by b.shop_open desc, public.km_between(b.lat, b.lng, p_lat, p_lng)
       limit 100
    ) s;
$$;

-- One search across every shop that delivers here: dishes and products by
-- name, description, brand or category, and shops by name.
create or replace function public.search_nearby(p_lat double precision, p_lng double precision, p_q text, p_segment text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := lower(btrim(coalesce(p_q, '')));
begin
  if length(q) < 2 or length(q) > 60 then
    return jsonb_build_object('shops', '[]'::jsonb, 'items', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'shops', (select coalesce(jsonb_agg(x order by (x->>'km')::numeric), '[]'::jsonb) from (
       select jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind, 'open', b.shop_open,
                                 'km', round(public.km_between(b.lat, b.lng, p_lat, p_lng)::numeric, 1)) as x
         from public.businesses b
        where b.status = 'verified' and public.business_licence_ok(b)
          and public.km_between(b.lat, b.lng, p_lat, p_lng) <= 25
          and (p_segment is null or public.kind_segment(b.kind) = p_segment)
          and position(q in lower(b.name)) > 0
        limit 10) s),
    'items', (select coalesce(jsonb_agg(x order by (x->>'km')::numeric, (x->>'price_paise')::int), '[]'::jsonb) from (
       select jsonb_build_object('id', i.id, 'name', i.name, 'price_paise', i.price_paise, 'mrp_paise', i.mrp_paise,
                                 'diet', i.diet, 'quantity', i.quantity_label, 'brand', i.brand, 'photo', i.photo_path,
                                 'sold_out', coalesce(i.stock = 0, false),
                                 'shop_id', b.id, 'shop', b.name, 'open', b.shop_open,
                                 'km', round(public.km_between(b.lat, b.lng, p_lat, p_lng)::numeric, 1)) as x
         from public.catalog_items i join public.businesses b on b.id = i.business_id
        where i.available and b.status = 'verified' and public.business_licence_ok(b)
          and public.km_between(b.lat, b.lng, p_lat, p_lng) <= 25
          and (p_segment is null or public.kind_segment(b.kind) = p_segment)
          and position(q in lower(i.name || ' ' || coalesce(i.description, '') || ' ' || coalesce(i.brand, '') || ' ' || coalesce(i.category, ''))) > 0
        limit 40) s));
end;
$$;

grant execute on function public.nearby_shops(double precision, double precision, text) to anon, authenticated;
grant execute on function public.search_nearby(double precision, double precision, text, text) to anon, authenticated;


-- ============================================================ group orders

-- A basket friends fill together from one link. Everyone adds their own items
-- under their own name; only the person who started it (holding the host key)
-- places the order, and everyone sees their share of the bill.
create table if not exists public.group_carts (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  host_key    text not null,
  business_id uuid not null references public.businesses(id) on delete cascade,
  host_name   text not null check (length(btrim(host_name)) between 1 and 30),
  status      text not null default 'open' check (status in ('open', 'ordered', 'closed')),
  order_token text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '3 hours'
);

create table if not exists public.group_cart_lines (
  id         uuid primary key default gen_random_uuid(),
  cart_id    uuid not null references public.group_carts(id) on delete cascade,
  member     text not null check (length(btrim(member)) between 1 and 30),
  item_id    uuid not null references public.catalog_items(id) on delete cascade,
  qty        integer not null check (qty between 1 and 20),
  selection  jsonb not null default '[]'::jsonb,
  added_at   timestamptz not null default now()
);
create index if not exists idx_group_cart_lines on public.group_cart_lines (cart_id, added_at);

-- No policies: every read and write goes through the functions below, by token.
alter table public.group_carts enable row level security;
alter table public.group_cart_lines enable row level security;

create or replace function public.create_group_cart(p_business uuid, p_host text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b    public.businesses;
  cart public.group_carts;
begin
  select * into b from public.businesses where id = p_business and status = 'verified';
  if b.id is null or not public.business_licence_ok(b) or not b.shop_open then
    raise exception 'This shop is not taking orders right now' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_host, ''))) not between 1 and 30 then
    raise exception 'Add your name' using errcode = '22023';
  end if;
  insert into public.group_carts (token, host_key, business_id, host_name)
  values (encode(extensions.gen_random_bytes(18), 'hex'), encode(extensions.gen_random_bytes(18), 'hex'), b.id, btrim(p_host))
  returning * into cart;
  return jsonb_build_object('token', cart.token, 'host_key', cart.host_key);
end;
$$;

create or replace function public.group_cart_view(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'business_id', c.business_id, 'shop', b.name, 'host', c.host_name, 'status', c.status,
           'expires_at', c.expires_at, 'order_token', c.order_token, 'delivery_paise', b.delivery_charge_paise,
           'lines', coalesce((
             select jsonb_agg(jsonb_build_object('id', l.id, 'member', l.member, 'item_id', l.item_id, 'name', i.name,
                                                 'qty', l.qty, 'selection', l.selection, 'diet', i.diet,
                                                 'unit_paise', (public._price_line(i, l.selection)->>'unit_paise')::int,
                                                 'options', public._price_line(i, l.selection)->'chosen') order by l.added_at)
               from public.group_cart_lines l join public.catalog_items i on i.id = l.item_id
              where l.cart_id = c.id and i.available), '[]'::jsonb))
    from public.group_carts c join public.businesses b on b.id = c.business_id
   where c.token = p_token and length(p_token) = 36;
$$;

create or replace function public.group_cart_add(p_token text, p_member text, p_item uuid, p_qty integer, p_selection jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c    public.group_carts;
  it   public.catalog_items;
  line uuid;
begin
  select * into c from public.group_carts where token = p_token and length(p_token) = 36 for update;
  if c.id is null or c.status <> 'open' or c.expires_at < now() then
    raise exception 'This group basket is closed' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_member, ''))) not between 1 and 30 then
    raise exception 'Add your name' using errcode = '22023';
  end if;
  if coalesce(p_qty, 0) not between 1 and 20 then
    raise exception 'Between 1 and 20 of each item' using errcode = '22023';
  end if;
  if (select count(*) from public.group_cart_lines where cart_id = c.id) >= 30 then
    raise exception 'The group basket is full' using errcode = '54000';
  end if;
  select * into it from public.catalog_items where id = p_item and business_id = c.business_id and available;
  if it.id is null then
    raise exception 'That item is not available' using errcode = '22023';
  end if;
  perform public._price_line(it, p_selection);   -- the options must be valid now, not only at checkout
  insert into public.group_cart_lines (cart_id, member, item_id, qty, selection)
  values (c.id, btrim(p_member), it.id, p_qty, coalesce(p_selection, '[]'::jsonb))
  returning id into line;
  return line;
end;
$$;

create or replace function public.group_cart_remove(p_token text, p_line uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.group_cart_lines l
   using public.group_carts c
   where l.id = p_line and l.cart_id = c.id and c.token = p_token and c.status = 'open';
$$;

-- The host places the whole basket as one order, then the basket closes.
create or replace function public.place_group_order(
  p_token text, p_host_key text, p_name text, p_phone text, p_area text, p_address text,
  p_lat double precision, p_lng double precision, p_note text, p_coupon text default null, p_scheduled_for timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c      public.group_carts;
  items  jsonb;
  placed jsonb;
begin
  select * into c from public.group_carts where token = p_token and length(p_token) = 36 for update;
  if c.id is null or c.host_key is distinct from p_host_key then
    raise exception 'Only the person who started this group basket can place it' using errcode = '42501';
  end if;
  if c.status <> 'open' then
    raise exception 'This group basket has already been ordered' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('id', l.item_id, 'qty', l.qty, 'options', l.selection) order by l.added_at)
    into items from public.group_cart_lines l where l.cart_id = c.id;
  if items is null then
    raise exception 'The group basket is empty' using errcode = '22023';
  end if;
  placed := public.place_order(c.business_id, p_name, p_phone, p_area, p_address, p_lat, p_lng,
                               left(coalesce(p_note || ' · ', '') || 'Group order', 300), items, p_coupon, p_scheduled_for);
  update public.group_carts set status = 'ordered', order_token = placed->>'token' where id = c.id;
  return placed;
end;
$$;

grant execute on function public.create_group_cart(uuid, text) to anon, authenticated;
grant execute on function public.group_cart_view(text) to anon, authenticated;
grant execute on function public.group_cart_add(text, text, uuid, integer, jsonb) to anon, authenticated;
grant execute on function public.group_cart_remove(text, uuid) to anon, authenticated;
grant execute on function public.place_group_order(text, text, text, text, text, text, double precision, double precision, text, text, timestamptz) to anon, authenticated;


-- ============================================================================ riders: job alerts and pay

-- A new job reaches the riders who could take it: verified, online in the last
-- 20 minutes, within 8 km of the pickup. It arrives as a notification, which
-- the app shows at once and send-push turns into a phone alert once deployed.
create or replace function public.notify_job_nearby()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'open' or new.business_id is null or new.pickup_lat is null then
    return new;
  end if;
  insert into public.notifications (id, user_id, title, description, kind, read, created_at)
  select gen_random_uuid()::text, a.user_id,
         'New job near you · ₹' || trim(to_char(new.payout, 'FM999990')),
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

drop trigger if exists trg_notify_job_nearby on public.jobs;
create trigger trg_notify_job_nearby
  after insert on public.jobs
  for each row execute function public.notify_job_nearby();
revoke all on function public.notify_job_nearby() from public, anon, authenticated;

-- The shop pays the rider their fare by UPI, to the UPI ID Gigzen verified,
-- and records the UTR. The rider sees it and can say it never arrived.
alter table public.jobs add column if not exists rider_paid_at timestamptz;
alter table public.jobs add column if not exists rider_pay_utr text;
alter table public.jobs add column if not exists rider_pay_disputed_at timestamptz;
alter table public.jobs drop constraint if exists jobs_rider_pay_utr_check;
alter table public.jobs add constraint jobs_rider_pay_utr_check check (rider_pay_utr is null or rider_pay_utr ~ '^[0-9A-Z]{10,22}$');

-- Who to pay and how much: only for the shop that sent the job, and only once it is delivered.
create or replace function public.job_rider_payee(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('name', v.legal_name, 'upi', v.upi_id, 'fare', j.payout,
                            'paid_at', j.rider_paid_at, 'utr', j.rider_pay_utr, 'disputed_at', j.rider_pay_disputed_at)
    from public.jobs j
    join public.businesses b on b.id = j.business_id
    join public.worker_verifications v on v.user_id = j.assigned_to
   where j.id = p_job and b.owner_id = auth.uid() and j.status = 'completed';
$$;

create or replace function public.mark_rider_paid(p_job uuid, p_utr text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  j   public.jobs;
  b   public.businesses;
  utr text := upper(regexp_replace(coalesce(p_utr, ''), '\s', '', 'g'));
begin
  select j2.* into j from public.jobs j2 join public.businesses b2 on b2.id = j2.business_id
   where j2.id = p_job and b2.owner_id = auth.uid() for update of j2;
  if j.id is null then
    raise exception 'No such delivery' using errcode = '42501';
  end if;
  if j.status <> 'completed' then
    raise exception 'Pay the rider once the delivery is done' using errcode = '22023';
  end if;
  if utr !~ '^[0-9A-Z]{10,22}$' then
    raise exception 'The UTR is the 12-digit reference in your UPI app''s payment details' using errcode = '22023';
  end if;
  if exists (select 1 from public.jobs where rider_pay_utr = utr and id <> j.id) then
    raise exception 'This UTR is already recorded for another delivery' using errcode = '23505';
  end if;
  select * into b from public.businesses where id = j.business_id;
  perform set_config('waggle.job_step', 'on', true);
  update public.jobs set rider_paid_at = now(), rider_pay_utr = utr, rider_pay_disputed_at = null where id = j.id;
  perform set_config('waggle.job_step', 'off', true);
  insert into public.notifications (id, user_id, title, description, kind, read, created_at)
  values (gen_random_uuid()::text, j.assigned_to, b.name || ' paid you ₹' || trim(to_char(j.payout, 'FM999990')),
          'For the delivery to ' || j.dropoff || ' · UPI reference ' || utr, 'job', false, now());
  return public.job_rider_payee(j.id);
end;
$$;

-- The rider: the payment the shop recorded never arrived.
create or replace function public.report_rider_unpaid(p_job uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job and assigned_to = auth.uid() for update;
  if j.id is null or j.status <> 'completed' then
    return 'not_yours';
  end if;
  if j.rider_paid_at is null then
    return 'not_marked';
  end if;
  perform set_config('waggle.job_step', 'on', true);
  update public.jobs set rider_pay_disputed_at = now() where id = j.id;
  perform set_config('waggle.job_step', 'off', true);
  return 'ok';
end;
$$;

revoke all on function public.job_rider_payee(uuid) from public, anon;
revoke all on function public.mark_rider_paid(uuid, text) from public, anon;
revoke all on function public.report_rider_unpaid(uuid) from public, anon;
grant execute on function public.job_rider_payee(uuid) to authenticated;
grant execute on function public.mark_rider_paid(uuid, text) to authenticated;
grant execute on function public.report_rider_unpaid(uuid) to authenticated;


-- ============================================================================
-- CHECK: run this after the file above. All 6 rows should say true.
-- ============================================================================
select 'billing_runs table' as item, to_regclass('public.billing_runs') is not null as ok
union all select 'month end schedule (pg_cron)', exists (select 1 from pg_extension where extname = 'pg_cron')
  and exists (select 1 from cron.job where jobname = 'waggle-month-end')
union all select 'job alert trigger', exists (select 1 from pg_trigger where tgname = 'trg_notify_job_nearby')
union all select 'rider pay columns', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'jobs' and column_name = 'rider_pay_utr')
union all select 'mark_rider_paid', to_regprocedure('public.mark_rider_paid(uuid, text)') is not null
union all select 'users cannot run month end', not has_function_privilege('authenticated', 'public._month_end(date, uuid)', 'execute');
