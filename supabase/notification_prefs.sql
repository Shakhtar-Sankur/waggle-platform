-- What a driver wants to be interrupted about.
--
-- Stored server-side, not on the device, and that is the whole point. The push
-- function sends FCM a `notification:` payload, which Android displays itself
-- while the app is backgrounded — the app never sees it and cannot suppress it.
-- So a preference kept only in local storage would be a switch that visibly
-- does nothing for the one case that matters: a promotional push arriving while
-- the app is closed. The sender has to check before sending.
--
-- Play's policy is the reason this exists: marketing notifications have to be
-- something a user can turn off, and "turn off every notification from this app
-- in Android settings" is not that — it takes the messages with it.

create table if not exists public.notification_prefs (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  -- Someone messaged you.
  chat       boolean not null default true,
  -- Likes, comments, connection requests.
  social     boolean not null default true,
  -- Trip and tracking notices.
  location   boolean not null default true,
  -- News and offers from Waggle. The only one most people will ever turn off,
  -- and the only one Play requires to be optional.
  promo      boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

-- Your row, yours to read and change. The push function runs under the service
-- role, which bypasses RLS, so it can read everyone's before sending.
drop policy if exists notification_prefs_own on public.notification_prefs;
create policy notification_prefs_own on public.notification_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Deliberately NOT back-filled for existing drivers.
--
-- A missing row means "not chosen yet", and every consumer treats that as all
-- four on — which matches how the app behaved before this table existed. A
-- back-fill would write a row for people who never opened the screen, and then
-- an added category later would default to whatever the back-fill guessed
-- rather than to the app's current behaviour.

comment on table public.notification_prefs is
  'Per-driver notification categories. Absent row = everything on. Checked by send-push before sending, since FCM notification payloads are shown by the OS and cannot be filtered on the device.';
