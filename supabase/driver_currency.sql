-- The currency a driver picked, so it follows them rather than the handset.
--
-- Every other setting on the profile screen is written to driver_settings and
-- read back at login: home address, base rate, daily goal, vehicle, share-stats.
-- The currency is the one exception. It lives only in the browser's local
-- storage, so it survives a reload and nothing else.
--
-- What that costs a real driver: someone working in Dubai turns OFF automatic
-- currency and picks AED on purpose, because auto-detection read their SIM or
-- their VPN wrong. They replace a cracked handset, sign in, and the app is back
-- to guessing — showing their earnings in the wrong currency, with no sign that
-- a choice was ever made. The deliberate override is exactly the setting that
-- must not be device-local.
--
-- Two columns, not one. `currency_code` is the choice; `currency_auto` is
-- whether the driver wants the app to keep guessing. They are independent: a
-- driver with auto ON still has a last-known code, and one with auto OFF must
-- not have their pick overwritten on the next launch.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table public.driver_settings
  add column if not exists currency_code text,
  add column if not exists currency_auto boolean not null default true;

-- ISO 4217 is three letters. A length check rather than a list of codes: the
-- app ships 61 currencies today and will add more, and a constraint that needs
-- editing every time one is added is a constraint that gets dropped.
alter table public.driver_settings
  drop constraint if exists driver_settings_currency_code_len;
alter table public.driver_settings
  add constraint driver_settings_currency_code_len
  check (currency_code is null or currency_code ~ '^[A-Z]{3}$');

comment on column public.driver_settings.currency_code is
  'ISO 4217 code the driver last displayed earnings in. Null means never set.';
comment on column public.driver_settings.currency_auto is
  'False when the driver turned off automatic currency and chose one themselves; their pick must not be overwritten by region detection.';

-- No policy changes needed: driver_settings already restricts every row to its
-- owner, and these are two more columns on a row the caller already owns.
