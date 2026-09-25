-- ============================================================================
-- Waggle payments v1: customers pay a shop's order online (Razorpay, with
-- Route splitting each payment straight to the shop's bank account).
--
-- Run AFTER business_v2.sql. Safe to run again. Nothing changes for anyone
-- until an admin switches online payment on (company_settings.online_pay_live)
-- and gives a shop its Razorpay linked account; until then orders stay pay on
-- delivery exactly as today.
--
-- Money never moves on the phone's word:
--   * the amount comes from the order in this database, not from the app;
--   * a payment counts only when Razorpay's signature checks out, either from
--     the app right after paying (pay-verify) or from Razorpay's own webhook
--     (pay-webhook), whichever arrives first; the second changes nothing;
--   * the Edge Functions that talk to Razorpay hold the keys; the app never
--     sees the secret, and the functions below are closed to everyone else.
-- ============================================================================


alter table public.company_settings add column if not exists online_pay_live boolean not null default false;
-- Waggle's cut of each online payment, in basis points (200 = 2%): it covers
-- Razorpay's own charge. The rest goes to the shop through Route.
alter table public.company_settings add column if not exists online_fee_bps integer not null default 200
  check (online_fee_bps between 0 and 1500);

-- The shop's Razorpay Route linked account ("acc_..."), created in Razorpay
-- from the bank details the shop gave at verification.
alter table public.businesses add column if not exists razorpay_account_id text
  check (razorpay_account_id is null or razorpay_account_id ~ '^acc_[A-Za-z0-9]{6,40}$');

alter table public.orders add column if not exists paid_online_at timestamptz;

create table if not exists public.order_payments (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  rzp_order_id   text not null unique,
  rzp_payment_id text unique,
  amount_paise   integer not null check (amount_paise > 0),
  shop_paise     integer not null check (shop_paise >= 0),
  status         text not null default 'created' check (status in ('created', 'paid')),
  created_at     timestamptz not null default now(),
  paid_at        timestamptz
);
create index if not exists idx_order_payments_order on public.order_payments (order_id);
alter table public.order_payments enable row level security;
revoke all on table public.order_payments from anon, authenticated;


-- What the tracking page needs: can this order be paid online now, and is it paid?
create or replace function public.online_pay_status(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'paid', o.paid_online_at is not null,
           'paid_at', o.paid_online_at,
           'amount', round(o.total_paise / 100.0, 2),
           'available', o.paid_online_at is null
                        and o.status in ('placed', 'accepted', 'dispatched')
                        and o.total_paise > 0
                        and b.razorpay_account_id is not null
                        and coalesce((select online_pay_live from public.company_settings where id), false))
    from public.orders o
    join public.businesses b on b.id = o.business_id
   where o.track_token = p_token and length(p_token) = 36;
$$;

-- For the Edge Function pay-create only (service key): what to charge and where it goes.
create or replace function public._payment_prepare(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o  public.orders;
  b  public.businesses;
  cs public.company_settings;
begin
  select * into o from public.orders where track_token = p_token and length(p_token) = 36;
  if o.id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  select * into b from public.businesses where id = o.business_id;
  select * into cs from public.company_settings where id;
  if not coalesce(cs.online_pay_live, false) or b.razorpay_account_id is null then
    return jsonb_build_object('error', 'not_available');
  end if;
  if o.paid_online_at is not null then
    return jsonb_build_object('error', 'already_paid');
  end if;
  if o.status not in ('placed', 'accepted', 'dispatched') or o.total_paise <= 0 then
    return jsonb_build_object('error', 'not_payable');
  end if;
  return jsonb_build_object(
    'order_id', o.id, 'code', o.code, 'shop', b.name, 'phone', o.customer_phone,
    'amount_paise', o.total_paise,
    'shop_paise', o.total_paise - round(o.total_paise * coalesce(cs.online_fee_bps, 200) / 10000.0)::int,
    'account', b.razorpay_account_id);
end;
$$;

create or replace function public._payment_created(p_order uuid, p_rzp_order text, p_amount integer, p_shop integer)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.order_payments (order_id, rzp_order_id, amount_paise, shop_paise)
  values (p_order, p_rzp_order, p_amount, p_shop)
  on conflict (rzp_order_id) do nothing;
$$;

-- Called only after the signature is checked. Idempotent: the app and the
-- webhook may both report the same payment.
create or replace function public._payment_paid(p_rzp_order text, p_rzp_payment text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.order_payments;
  o   public.orders;
  owner uuid;
begin
  select * into pay from public.order_payments where rzp_order_id = p_rzp_order for update;
  if pay.id is null then
    return 'unknown_order';
  end if;
  if pay.status = 'paid' then
    return 'already';
  end if;
  update public.order_payments set status = 'paid', rzp_payment_id = p_rzp_payment, paid_at = now() where id = pay.id;
  update public.orders set paid_online_at = now(), updated_at = now() where id = pay.order_id and paid_online_at is null returning * into o;
  select owner_id into owner from public.businesses where id = o.business_id;
  if owner is not null then
    insert into public.notifications (id, user_id, title, description, kind, read, created_at)
    values (gen_random_uuid()::text, owner, 'Paid online', 'Order ' || o.code || ' was paid online: ' || to_char(o.total_paise / 100.0, 'FM999990.00') || ' rupees. Do not collect cash.', 'job', false, now());
  end if;
  return 'ok';
end;
$$;

-- The rider carrying an order: collect cash, or not.
create or replace function public.job_order_payment(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('amount', round(o.total_paise / 100.0, 2), 'paid_online', o.paid_online_at is not null)
    from public.orders o
    join public.jobs j on j.id = o.job_id
   where o.job_id = p_job and j.assigned_to = auth.uid() and j.status in ('accepted', 'picked_up');
$$;

-- Gigzen's switches.
create or replace function public.admin_online_pay(p_live boolean, p_fee_bps integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.company_settings
     set online_pay_live = p_live, online_fee_bps = coalesce(p_fee_bps, online_fee_bps)
   where id;
end;
$$;

create or replace function public.admin_set_razorpay_account(p_business uuid, p_account text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  update public.businesses set razorpay_account_id = nullif(btrim(coalesce(p_account, '')), '') where id = p_business;
  if not found then
    raise exception 'No such business' using errcode = '22023';
  end if;
end;
$$;

-- Gigzen's view: online payment on or off, the fee, and each verified shop's linked account.
create or replace function public.admin_online_pay_view()
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
    'live', (select online_pay_live from public.company_settings where id),
    'fee_bps', (select online_fee_bps from public.company_settings where id),
    'shops', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'account', b.razorpay_account_id) order by b.name)
                         from public.businesses b where b.status = 'verified'), '[]'::jsonb),
    'paid_30d', (select count(*) from public.order_payments where status = 'paid' and paid_at > now() - interval '30 days'));
end;
$$;

revoke all on function public.admin_online_pay_view() from public, anon;
grant execute on function public.admin_online_pay_view() to authenticated;
revoke all on function public._payment_prepare(text) from public, anon, authenticated;
revoke all on function public._payment_created(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public._payment_paid(text, text) from public, anon, authenticated;
revoke all on function public.job_order_payment(uuid) from public, anon;
revoke all on function public.admin_online_pay(boolean, integer) from public, anon;
revoke all on function public.admin_set_razorpay_account(uuid, text) from public, anon;
grant execute on function public._payment_prepare(text) to service_role;
grant execute on function public._payment_created(uuid, text, integer, integer) to service_role;
grant execute on function public._payment_paid(text, text) to service_role;
grant execute on function public.online_pay_status(text) to anon, authenticated;
grant execute on function public.job_order_payment(uuid) to authenticated;
grant execute on function public.admin_online_pay(boolean, integer) to authenticated;
grant execute on function public.admin_set_razorpay_account(uuid, text) to authenticated;
