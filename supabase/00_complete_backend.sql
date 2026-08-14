-- ============================================================================
-- Buzz Buzz — COMPLETE BACKEND
-- ============================================================================
--
-- Everything the app needs, in one file, in dependency order. Paste it into the
-- Supabase SQL editor and run it once.
--
-- Safe to run more than once: every statement is written to be idempotent, so
-- re-running it on an existing project repairs drift rather than erroring.
--
-- Safe to run on a project that already has data. Nothing here drops a table or
-- deletes a row. (The one `delete from auth.users` you will find lives inside
-- delete_own_account() and only ever removes the caller's own account.)
--
-- ORDER MATTERS, and one thing in particular:
--   privacy_lockdown comes late on purpose. Earlier sections open read access
--   while building tables; that section is what closes it. Moving it earlier
--   would leave driver data publicly readable.
--
-- AFTER RUNNING, in the dashboard:
--   Authentication -> Providers -> Email -> turn OFF "Confirm email"
--     (otherwise nobody can sign in after signing up)
--
-- Assembled from the fifteen verified migration files rather than rewritten,
-- because a confident rewrite of row-level security is how data gets exposed.
-- Part 16 at the end is new: the indexes, limits and integrity checks the
-- incremental files never went back to add.
-- ============================================================================




-- ==========================================================================
-- PART 1 — TABLES, ROW-LEVEL SECURITY, AND THE ACCOUNT-DELETION RPC
-- source: schema.sql
-- ==========================================================================

-- Masaya Ako production schema for Supabase.
-- Run this in Supabase SQL Editor, then set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default 'Driver',
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  -- Free text on purpose: the platform catalogue (Uber, Ola, Swiggy, Zomato,
  -- Amazon Flex, Grab, Bolt, Careem…) grows per country and lives in the
  -- client's WorkAppId union. See supabase/work_apps_global.sql.
  active_app text,
  home_address text default '',
  base_rate numeric not null default 10,
  daily_goal numeric not null default 500,
  vehicle_type text not null default 'car' check (vehicle_type in ('car','motorcycle','bicycle')),
  maintenance_km numeric not null default 850,
  share_stats boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.worker_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  active_app text,
  today_distance_km numeric not null default 0,
  today_earnings numeric not null default 0,
  rating numeric not null default 4.8,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.route_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  active_app text,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  recorded_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  pickup text not null,
  dropoff text not null,
  distance_km numeric not null,
  payout numeric not null,
  app text not null,
  eta_minutes integer not null,
  status text not null default 'open' check (status in ('open','accepted','declined','completed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  likes integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  is_group boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_thread_members (
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table if not exists public.chat_messages (
  id text primary key,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  attachment_url text,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null,
  kind text not null default 'system',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Needed by the worker_locations read policy below.
alter table public.worker_locations
  add column if not exists share_stats boolean not null default true;

-- PostgREST honours column-level GRANTs. The client never SELECTs profiles.phone
-- (it is written at signup and read from the auth session), so revoking it costs
-- nothing and keeps phone numbers off the API entirely.
revoke select (phone) on public.profiles from anon;
revoke select (phone) on public.profiles from authenticated;

alter table public.profiles enable row level security;
alter table public.driver_settings enable row level security;
alter table public.worker_locations enable row level security;
alter table public.route_points enable row level security;
alter table public.jobs enable row level security;
alter table public.feed_posts enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_thread_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.notifications enable row level security;

-- `using (true)` means EVERYONE, including the anonymous role. The publishable
-- key ships inside the APK and can be extracted from it in about a minute, so
-- anonymous in practice means anybody who downloads the app. These tables hold
-- phone numbers and live GPS, so read access requires a session.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles
  for select using (auth.role() = 'authenticated');
drop policy if exists "profiles own write" on public.profiles;
create policy "profiles own write" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "settings own" on public.driver_settings;
create policy "settings own" on public.driver_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Honours the driver's "Share stats with community" switch. A driver can always
-- see their own row.
drop policy if exists "locations readable" on public.worker_locations;
create policy "locations readable" on public.worker_locations
  for select using (
    auth.role() = 'authenticated'
    and (share_stats or user_id = auth.uid())
  );
drop policy if exists "locations own write" on public.worker_locations;
create policy "locations own write" on public.worker_locations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "route own" on public.route_points;
create policy "route own" on public.route_points for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "jobs readable" on public.jobs;
create policy "jobs readable" on public.jobs for select using (assigned_to is null or assigned_to = auth.uid());
drop policy if exists "jobs update assignee" on public.jobs;
create policy "jobs update assignee" on public.jobs for update using (assigned_to is null or assigned_to = auth.uid()) with check (assigned_to is null or assigned_to = auth.uid());

drop policy if exists "posts readable" on public.feed_posts;
create policy "posts readable" on public.feed_posts
  for select using (auth.role() = 'authenticated');
drop policy if exists "posts own insert" on public.feed_posts;
create policy "posts own insert" on public.feed_posts for insert with check (auth.uid() = user_id);
drop policy if exists "posts own update" on public.feed_posts;
create policy "posts own update" on public.feed_posts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Membership check via SECURITY DEFINER so RLS policies never query
-- chat_thread_members recursively (which caused infinite-recursion errors).
create or replace function public.is_thread_member(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chat_thread_members
    where thread_id = p_thread_id and user_id = p_user_id
  );
$$;

drop policy if exists "threads member read" on public.chat_threads;
create policy "threads member read" on public.chat_threads for select using (
  public.is_thread_member(id, auth.uid()) or created_by = auth.uid()
);
drop policy if exists "threads own insert" on public.chat_threads;
create policy "threads own insert" on public.chat_threads for insert with check (auth.uid() = created_by);
drop policy if exists "threads member update" on public.chat_threads;
create policy "threads member update" on public.chat_threads for update
  using (public.is_thread_member(id, auth.uid()) or created_by = auth.uid())
  with check (public.is_thread_member(id, auth.uid()) or created_by = auth.uid());

drop policy if exists "members readable by members" on public.chat_thread_members;
create policy "members readable by members" on public.chat_thread_members for select using (
  public.is_thread_member(thread_id, auth.uid())
);
drop policy if exists "members own insert" on public.chat_thread_members;
create policy "members own insert" on public.chat_thread_members for insert with check (auth.uid() = user_id);

drop policy if exists "messages member read" on public.chat_messages;
create policy "messages member read" on public.chat_messages for select using (
  public.is_thread_member(chat_messages.thread_id, auth.uid())
);
drop policy if exists "messages member insert" on public.chat_messages;
create policy "messages member insert" on public.chat_messages for insert with check (
  auth.uid() = sender_id and
  public.is_thread_member(chat_messages.thread_id, auth.uid())
);

drop policy if exists "notifications own" on public.notifications;
create policy "notifications own" on public.notifications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.device_tokens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.device_tokens enable row level security;
drop policy if exists "tokens own" on public.device_tokens;
create policy "tokens own" on public.device_tokens for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

-- NOTE: this file used to seed three sample jobs here. They were removed —
-- Buzz Buzz has no real job source (it does not integrate with Grab/Angkas
-- dispatch), the job feed was taken off the Home screen, and seeding invented
-- listings put fake data in a production database. The `jobs` table is kept so
-- the schema stays stable, but it starts EMPTY.
--
-- If your database still holds the old sample rows, remove them with:
--   delete from public.jobs
--    where title in ('Food pickup at BGC', 'Passenger ride', 'Parcel delivery');



-- ==========================================================================
-- PART 2 — PRODUCTION HARDENING APPLIED ON TOP OF THE BASE SCHEMA
-- source: production.sql
-- ==========================================================================

-- Masaya Ako — production hardening (run AFTER schema.sql).
-- Adds performance indexes, updated_at triggers, and server-side chat push.
-- Safe to re-run (idempotent).

-- ---------------------------------------------------------------------------
-- 1. Performance indexes (keep queries fast as the user base grows)
-- ---------------------------------------------------------------------------
create index if not exists idx_jobs_status_created on public.jobs (status, created_at desc);
create index if not exists idx_jobs_assigned_to on public.jobs (assigned_to);
create index if not exists idx_feed_posts_created on public.feed_posts (created_at desc);
create index if not exists idx_chat_messages_thread_created on public.chat_messages (thread_id, created_at);
create index if not exists idx_chat_members_user on public.chat_thread_members (user_id);
create index if not exists idx_notifications_user_created on public.notifications (user_id, created_at desc);
create index if not exists idx_worker_locations_updated on public.worker_locations (updated_at desc);
create index if not exists idx_route_points_user_recorded on public.route_points (user_id, recorded_at desc);
create index if not exists idx_device_tokens_user on public.device_tokens (user_id);

-- ---------------------------------------------------------------------------
-- 2. Keep updated_at columns accurate automatically
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_driver_settings_touch on public.driver_settings;
create trigger trg_driver_settings_touch before update on public.driver_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_jobs_touch on public.jobs;
create trigger trg_jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Server-side push configuration
--    Fill this single row once (see supabase/PUSH_SETUP.md).
-- ---------------------------------------------------------------------------
create schema if not exists private;

create table if not exists private.push_config (
  id int primary key default 1 check (id = 1),
  function_url text not null,     -- https://<project-ref>.supabase.co/functions/v1/send-push
  webhook_secret text not null,   -- must match PUSH_WEBHOOK_SECRET function secret
  enabled boolean not null default true
);

-- This row holds a shared secret, so lock it down three ways rather than relying
-- on any one of them:
--
--   1. It lives in `private`, a schema PostgREST does not expose, so the API
--      cannot reach it at all.
--   2. No grants to anon or authenticated, so even if the schema were exposed
--      later the roles have nothing.
--   3. RLS on with no policies, which denies every non-owner by default.
--
-- None of this affects the push trigger below: it is SECURITY DEFINER and runs
-- as the table owner, and the edge function uses the service role. Both bypass
-- RLS. Supabase's SQL editor warns about a table created without RLS — this is
-- the answer to that warning, in the file, rather than a checkbox someone has to
-- remember to tick.
alter table private.push_config enable row level security;
revoke all on schema private from anon, authenticated;
revoke all on private.push_config from anon, authenticated;

-- pg_net lets Postgres make outbound HTTP calls (used to invoke the edge function).
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 4. Push a notification to every OTHER member when a chat message arrives
-- ---------------------------------------------------------------------------
create or replace function public.notify_new_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg private.push_config%rowtype;
  sender_name text;
  member record;
  preview text;
begin
  select * into cfg from private.push_config where id = 1;
  if not found or cfg.enabled is false then
    return new;
  end if;

  select coalesce(full_name, 'A driver') into sender_name
  from public.profiles where id = new.sender_id;

  preview := left(new.body, 120);

  for member in
    select user_id
    from public.chat_thread_members
    where thread_id = new.thread_id
      and user_id <> new.sender_id
  loop
    -- Fire-and-forget HTTP call; failures here must not block the insert.
    perform net.http_post(
      url := cfg.function_url,
      body := jsonb_build_object(
        'userId', member.user_id,
        'title', sender_name,
        'body', preview,
        'data', jsonb_build_object('threadId', new.thread_id::text, 'kind', 'chat')
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', cfg.webhook_secret
      )
    );
  end loop;

  return new;
exception
  when others then
    -- Never let a push failure roll back the message.
    raise warning 'notify_new_chat_message failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_chat_message_push on public.chat_messages;
create trigger trg_chat_message_push
  after insert on public.chat_messages
  for each row execute function public.notify_new_chat_message();

-- ---------------------------------------------------------------------------
-- chat_messages.id is a text primary key with no default, so every client has
-- to invent one. The app does; anything that forgets gets "null value in column
-- id violates not-null constraint" and cannot send a message at all. A default
-- makes the database stop depending on every caller remembering.
-- ---------------------------------------------------------------------------
alter table public.chat_messages
  alter column id set default gen_random_uuid()::text;



-- ==========================================================================
-- PART 3 — LIKES, COMMENTS AND CONNECTIONS
-- source: social_features.sql
-- ==========================================================================

-- Masaya Ako — social features: post likes, comments, and driver connections.
-- Run once in the Supabase SQL Editor. Safe to re-run (idempotent).

-- ---------------------------------------------------------------------------
-- POST LIKES
-- ---------------------------------------------------------------------------
create table if not exists public.post_likes (
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_likes enable row level security;
drop policy if exists "likes readable" on public.post_likes;
create policy "likes readable" on public.post_likes
  for select using (auth.role() = 'authenticated');
drop policy if exists "likes own insert" on public.post_likes;
create policy "likes own insert" on public.post_likes for insert with check (auth.uid() = user_id);
drop policy if exists "likes own delete" on public.post_likes;
create policy "likes own delete" on public.post_likes for delete using (auth.uid() = user_id);
create index if not exists idx_post_likes_post on public.post_likes (post_id);

-- ---------------------------------------------------------------------------
-- POST COMMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.post_comments enable row level security;
drop policy if exists "comments readable" on public.post_comments;
create policy "comments readable" on public.post_comments
  for select using (auth.role() = 'authenticated');
drop policy if exists "comments own insert" on public.post_comments;
create policy "comments own insert" on public.post_comments for insert with check (auth.uid() = user_id);
drop policy if exists "comments own delete" on public.post_comments;
create policy "comments own delete" on public.post_comments for delete using (auth.uid() = user_id);
create index if not exists idx_post_comments_post on public.post_comments (post_id, created_at);

-- ---------------------------------------------------------------------------
-- CONNECTIONS (driver friend requests)
-- ---------------------------------------------------------------------------
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id)
);
alter table public.connections enable row level security;
drop policy if exists "connections readable by parties" on public.connections;
create policy "connections readable by parties" on public.connections for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
drop policy if exists "connections request" on public.connections;
create policy "connections request" on public.connections for insert
  with check (auth.uid() = requester_id and requester_id <> addressee_id);
drop policy if exists "connections accept" on public.connections;
create policy "connections accept" on public.connections for update
  using (auth.uid() = addressee_id) with check (auth.uid() = addressee_id);
drop policy if exists "connections remove" on public.connections;
create policy "connections remove" on public.connections for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
create index if not exists idx_connections_requester on public.connections (requester_id);
create index if not exists idx_connections_addressee on public.connections (addressee_id);

-- Allow reading any profile so connection lists/other profiles resolve names.
-- (profiles already has a "profiles readable" using(true) policy from schema.sql.)



-- ==========================================================================
-- PART 4 — COMMUNITY GROUPS WITH REAL MEMBERSHIP COUNTS
-- source: groups.sql
-- ==========================================================================

-- Real community groups: stored in the cloud with REAL member counts.
-- Joining/leaving writes a membership row; every client sees the true count.
--
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

create table if not exists public.groups (
  id text primary key,
  name text not null,
  description text not null default '',
  color text not null default '#ff4d17',
  icon text not null default '🚗',
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id text not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select using (auth.role() = 'authenticated');

drop policy if exists group_members_read on public.group_members;
create policy group_members_read on public.group_members
  for select using (auth.role() = 'authenticated');

drop policy if exists group_members_join on public.group_members;
create policy group_members_join on public.group_members
  for insert with check (auth.uid() = user_id);

drop policy if exists group_members_leave on public.group_members;
create policy group_members_leave on public.group_members
  for delete using (auth.uid() = user_id);

-- Starter groups (member counts are REAL — they start at zero).
insert into public.groups (id, name, description, color, icon) values
  ('group_grab_mnl',  'Grab Drivers Manila',            'Tips, surge alerts, and support for Metro Manila Grab drivers.', '#00b14f', '🚗'),
  ('group_angkas',    'Angkas Riders PH',               'Route hacks and rider community for Angkas motorcycle drivers.', '#0d3b66', '🏍️'),
  ('group_foodpanda', 'Foodpanda Riders Community',     'Peak-hour zones, batching tips, and rider meetups.',             '#d70f64', '🛵'),
  ('group_traffic',   'Metro Manila Traffic Updates',   'Live road, flood, and checkpoint updates from fellow drivers.',  '#f59e0b', '🚦'),
  ('group_tips',      'Gig Worker Tips & Tricks',       'Earn more, spend less — advice from experienced gig drivers.',   '#7c3aed', '💡')
on conflict (id) do nothing;



-- ==========================================================================
-- PART 5 — ONE-TO-ONE CONVERSATIONS
-- source: direct_messages.sql
-- ==========================================================================

-- Masaya Ako — private 1-on-1 chat. Run once. Safe to re-run.
-- A SECURITY DEFINER function so a user can start a direct thread with another
-- user (adding both members), which row-level security otherwise prevents.

create or replace function public.start_direct_thread(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing uuid;
  new_id uuid;
begin
  if me is null or me = p_other then
    raise exception 'Invalid direct thread';
  end if;

  -- Reuse an existing 1-on-1 thread between exactly these two people.
  select t.id into existing
  from public.chat_threads t
  where t.is_group = false
    and (select count(*) from public.chat_thread_members m where m.thread_id = t.id) = 2
    and exists (select 1 from public.chat_thread_members m where m.thread_id = t.id and m.user_id = me)
    and exists (select 1 from public.chat_thread_members m where m.thread_id = t.id and m.user_id = p_other)
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into public.chat_threads (title, is_group, created_by)
  values (coalesce((select full_name from public.profiles where id = p_other), 'Driver'), false, me)
  returning id into new_id;

  insert into public.chat_thread_members (thread_id, user_id)
  values (new_id, me), (new_id, p_other);

  return new_id;
end;
$$;

revoke all on function public.start_direct_thread(uuid) from public;
grant execute on function public.start_direct_thread(uuid) to authenticated;



-- ==========================================================================
-- PART 6 — PHOTO COLUMN ON COMMUNITY POSTS
-- source: post_photos.sql
-- ==========================================================================

-- Masaya Ako — allow photos on community posts. Run once. Safe to re-run.
alter table public.feed_posts add column if not exists image_url text;



-- ==========================================================================
-- PART 7 — LAST_SEEN, FOR ONLINE / LAST-SEEN STATES
-- source: presence.sql
-- ==========================================================================

-- WhatsApp-style presence / "last seen"
-- Adds a heartbeat timestamp to profiles. The app updates it every ~45s while the
-- app is open (foreground). Other users read it to show "online" vs "last seen X".
--
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

alter table public.profiles
  add column if not exists last_seen timestamptz;

-- Let each user update their OWN last_seen. profiles already lets a user update
-- their own row for name/phone; this makes sure the heartbeat is allowed even if
-- your update policy is column-scoped.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_update_own_presence'
  ) then
    drop policy if exists profiles_update_own_presence on public.profiles;
    create policy profiles_update_own_presence
      on public.profiles
      for update
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;

-- Optional: index so "who is online" style lookups stay fast at scale.
create index if not exists profiles_last_seen_idx on public.profiles (last_seen);



-- ==========================================================================
-- PART 8 — WORK PLATFORMS BEYOND THE ORIGINAL PHILIPPINE LIST
-- source: work_apps_global.sql
-- ==========================================================================

-- Buzz Buzz — allow work platforms beyond the original six Philippine apps.
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- WHY THIS IS REQUIRED:
--   driver_settings.active_app and jobs.app were created with a hard CHECK:
--       check (active_app in ('grab','angkas','moveit','joyride','foodpanda','others'))
--   The app now offers Uber, Ola, Swiggy, Zomato, Amazon Flex, Flipkart,
--   Rapido, Blinkit, Zepto, Gojek, Bolt, Careem, DoorDash, Deliveroo and more.
--   WITHOUT this migration, a driver who picks any new platform gets their
--   settings save REJECTED by Postgres (23514 check_violation) — the choice
--   silently fails to sync and reverts on their next device.
--
-- WHY WE DROP THE CHECK RATHER THAN EXTEND IT:
--   The platform list is a fast-moving, per-country catalogue — new delivery
--   apps appear constantly. Pinning it in a CHECK means a database migration
--   every time a country is added, and a hard failure for anyone who updates
--   the app before the migration runs. The allowed set is enforced in the
--   client by the WorkAppId TypeScript union, and RLS already restricts every
--   write to the row's own owner, so a free-text column is the right trade.

-- ---------------------------------------------------------------------------
-- 1. driver_settings.active_app — drop the constraint whatever it is named.
--    (Named constraints differ between projects, so find it dynamically.)
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname, rel.relname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and con.contype = 'c'
       and rel.relname in ('driver_settings', 'jobs')
       and pg_get_constraintdef(con.oid) ilike '%grab%'
  loop
    execute format('alter table public.%I drop constraint %I', c.relname, c.conname);
    raise notice 'dropped % on %', c.conname, c.relname;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Keep the columns sane: still text, still required where it was required.
--    (No-ops if already correct — included so a fresh database matches.)
-- ---------------------------------------------------------------------------
alter table public.driver_settings alter column active_app type text;
alter table public.jobs           alter column app        type text;

-- ---------------------------------------------------------------------------
-- 3. Verify — should return NO rows mentioning the old six-app list.
-- ---------------------------------------------------------------------------
select rel.relname as table_name,
       con.conname as constraint_name,
       pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
 where nsp.nspname = 'public'
   and con.contype = 'c'
   and rel.relname in ('driver_settings', 'jobs');



-- ==========================================================================
-- PART 9 — IS_THREAD_MEMBER: BREAKS THE RLS RECURSION THAT BROKE EVERY CHAT READ
-- source: fix_chat_rls.sql
-- ==========================================================================

-- Masaya Ako — CHAT RLS FIX (run once on an existing database). Safe to re-run.
-- Fixes three chat security-policy problems:
--   1. Infinite recursion on chat_thread_members (broke reading threads/messages).
--   2. Thread creator could not see the thread they just created (create failed).
--   3. No policy let a member bump a thread's updated_at when sending a message.

-- Helper: membership check with definer rights so policies never recurse.
create or replace function public.is_thread_member(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chat_thread_members
    where thread_id = p_thread_id and user_id = p_user_id
  );
$$;

-- chat_threads: members OR the creator can read (creator needs it right after insert).
drop policy if exists "threads member read" on public.chat_threads;
create policy "threads member read" on public.chat_threads for select using (
  public.is_thread_member(id, auth.uid()) or created_by = auth.uid()
);

-- chat_threads: members can update (used to bump updated_at when a message is sent).
drop policy if exists "threads member update" on public.chat_threads;
create policy "threads member update" on public.chat_threads for update
  using (public.is_thread_member(id, auth.uid()) or created_by = auth.uid())
  with check (public.is_thread_member(id, auth.uid()) or created_by = auth.uid());

-- chat_thread_members: non-recursive read.
drop policy if exists "members readable by members" on public.chat_thread_members;
create policy "members readable by members" on public.chat_thread_members for select using (
  public.is_thread_member(thread_id, auth.uid())
);

-- chat_messages: read/insert restricted to thread members, no recursion.
drop policy if exists "messages member read" on public.chat_messages;
create policy "messages member read" on public.chat_messages for select using (
  public.is_thread_member(chat_messages.thread_id, auth.uid())
);

drop policy if exists "messages member insert" on public.chat_messages;
create policy "messages member insert" on public.chat_messages for insert with check (
  auth.uid() = sender_id and
  public.is_thread_member(chat_messages.thread_id, auth.uid())
);



-- ==========================================================================
-- PART 10 — DRIVERS MAY DELETE THEIR OWN POSTS AND MESSAGES
-- source: user_content_control.sql
-- ==========================================================================

-- Buzz Buzz — let drivers DELETE their own content, plus one missing index.
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- Why this exists:
--   1. feed_posts had INSERT/SELECT/UPDATE but NO DELETE policy, so a driver
--      could never remove a post they regretted — the app's "⋯" only hid it
--      locally while everyone else still saw it forever.
--   2. chat_messages had the same gap: no way to delete a message you sent.
--   3. group_members is keyed (group_id, user_id). The app's "which groups am
--      I in?" query filters on user_id alone — the second PK column — which
--      Postgres cannot use that index for.

-- ---------------------------------------------------------------------------
-- 1. A driver may delete their own post. Likes/comments on it cascade away
--    via the existing foreign keys.
-- ---------------------------------------------------------------------------
drop policy if exists feed_posts_delete_own on public.feed_posts;
create policy feed_posts_delete_own on public.feed_posts
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. A driver may delete a message they sent. Deliberately restricted to their
--    OWN messages — being a thread member must not let you delete other
--    people's messages.
-- ---------------------------------------------------------------------------
drop policy if exists chat_messages_delete_own on public.chat_messages;
create policy chat_messages_delete_own on public.chat_messages
  for delete using (auth.uid() = sender_id);

-- ---------------------------------------------------------------------------
-- 3. Index the membership lookup by user.
-- ---------------------------------------------------------------------------
create index if not exists idx_group_members_user
  on public.group_members (user_id);

-- ---------------------------------------------------------------------------
-- 4. Sanity check — should list the two new delete policies and the index.
-- ---------------------------------------------------------------------------
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and policyname in ('feed_posts_delete_own', 'chat_messages_delete_own')
 order by tablename;

select indexname from pg_indexes
 where schemaname = 'public' and indexname = 'idx_group_members_user';

-- ============================================================================
-- Leaving a group conversation.
--
-- chat_thread_members had policies for reading and joining but none for
-- leaving, so a driver could be added to a group and never get out. The chat
-- header's overflow button had nothing it could offer because of it.
--
-- Self only: the predicate is the caller's own row, so this cannot be used to
-- remove somebody else from a conversation.
-- ============================================================================
drop policy if exists chat_members_leave_own on public.chat_thread_members;
create policy chat_members_leave_own
  on public.chat_thread_members for delete
  to authenticated
  using (user_id = auth.uid());



-- ==========================================================================
-- PART 11 — CLOSES PUBLIC READ ACCESS — MUST COME AFTER EVERYTHING THAT OPENS IT
-- source: privacy_lockdown.sql
-- ==========================================================================

-- Buzz Buzz — CLOSE PUBLIC READ ACCESS TO DRIVER DATA.  ** RUN THIS BEFORE LAUNCH **
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- ============================================================================
-- WHAT WAS WRONG
-- ============================================================================
-- Five tables were created with `for select using (true)`. In Postgres RLS,
-- `true` means EVERYONE — including the anonymous role. The app's publishable
-- key ships inside the Android APK and can be extracted from the .apk file in
-- about a minute, so "anonymous" in practice means "anybody who installs the
-- app or downloads it from the Play Store".
--
-- Verified live against the production project with only the publishable key
-- and no login:
--   • public.profiles          → id, full_name, PHONE, avatar_url, last_seen
--   • public.worker_locations  → user_id, LAT, LNG, accuracy, active_app,
--                                today_distance_km, today_earnings, rating
--   • public.feed_posts        → every community post
--   • public.post_likes / post_comments → all social activity
--
-- i.e. anyone could continuously harvest every driver's PHONE NUMBER and LIVE
-- GPS POSITION. For gig workers that is a stalking and harassment risk, and it
-- is very likely a breach of India's DPDP Act, the Philippines Data Privacy
-- Act, and GDPR where applicable.
--
-- ============================================================================
-- 1. Stop exposing phone numbers through the API at all.
--    PostgREST honours column-level GRANTs. The client never SELECTs
--    profiles.phone (it is written on signup and read from the auth session),
--    so removing it breaks nothing.
-- ============================================================================
-- A column-level REVOKE against a table-level GRANT does NOTHING. Postgres does
-- not subtract a column from a whole-table privilege, so the two statements this
-- replaces left phone readable by every signed-in account — which the
-- verification query at the bottom of this file reported honestly, and which
-- nobody read. The only way to restrict a column is to drop the table grant and
-- re-grant the columns you do want.
--
-- Verified against the client before writing this: the app never SELECTs
-- profiles.phone. It writes it on signup and reads it back from the auth
-- session, so nothing here breaks.

revoke select on public.profiles from anon;
revoke select on public.profiles from authenticated;

-- Everything except phone. New columns must be added here too, or PostgREST
-- will not return them.
grant select (id, full_name, avatar_url, last_seen, created_at, updated_at)
  on public.profiles to authenticated;

-- Writes are granted at TABLE level, not per column.
--
-- Column-level insert/update grants here broke signup outright: the profile
-- upsert came back "permission denied for table profiles", no profile row was
-- created, and every later post and group-join then failed on a foreign key.
-- Populace found it by simulating six signups; the app had never been run
-- against this project.
--
-- Restricting SELECT is the whole point of this section, and that is done
-- above. Restricting writes buys nothing: RLS already confines a driver to
-- their own row, and the app must write phone on signup.
grant insert, update, delete on public.profiles to authenticated;

-- anon keeps nothing. Reading community data requires a session.
revoke all on public.profiles from anon;

-- ============================================================================
-- 2. Require a logged-in session to read community data.
-- ============================================================================
drop policy if exists "profiles readable" on public.profiles;
drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read_authenticated on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "posts readable" on public.feed_posts;
drop policy if exists feed_posts_read_authenticated on public.feed_posts;
create policy feed_posts_read_authenticated on public.feed_posts
  for select using (auth.role() = 'authenticated');

drop policy if exists "likes readable" on public.post_likes;
drop policy if exists post_likes_read_authenticated on public.post_likes;
create policy post_likes_read_authenticated on public.post_likes
  for select using (auth.role() = 'authenticated');

drop policy if exists "comments readable" on public.post_comments;
drop policy if exists post_comments_read_authenticated on public.post_comments;
create policy post_comments_read_authenticated on public.post_comments
  for select using (auth.role() = 'authenticated');

-- ============================================================================
-- 3. Location: make the "Share stats with community" switch REAL.
--    Until now that toggle was stored and displayed but never enforced
--    anywhere — a driver could switch it off and their GPS kept uploading and
--    kept being served. Now the database itself honours it.
--    A driver can always see their own row.
-- ============================================================================
alter table public.worker_locations
  add column if not exists share_stats boolean not null default true;

drop policy if exists "locations readable" on public.worker_locations;
drop policy if exists worker_locations_read_authenticated on public.worker_locations;
create policy worker_locations_read_authenticated on public.worker_locations
  for select using (
    auth.role() = 'authenticated'
    and (share_stats or user_id = auth.uid())
  );

-- ============================================================================
-- 4. Verify. After running, `anon_can_read` must be FALSE for every row.
-- ============================================================================
select tablename,
       policyname,
       cmd,
       qual as using_expression,
       (qual = 'true') as anon_can_read
  from pg_policies
 where schemaname = 'public'
   and cmd = 'SELECT'
   and tablename in ('profiles','worker_locations','feed_posts','post_likes','post_comments')
 order by tablename;

-- Phone must not be SELECTable by anyone but the postgres role.
--
-- This used to be a plain SELECT whose comment said "should return no rows". It
-- returned eight, every time, and printing them changed nothing — a check that
-- only prints is a check that gets scrolled past. It now raises, so the script
-- cannot report success while driver phone numbers are still readable.
do $$
declare
  leaked int;
  who text;
begin
  select count(*), coalesce(string_agg(distinct grantee, ', '), '')
    into leaked, who
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'profiles'
     and column_name = 'phone'
     and privilege_type = 'SELECT'
     and grantee in ('anon', 'authenticated');

  if leaked > 0 then
    raise exception
      'PRIVACY CHECK FAILED: % can still SELECT profiles.phone. Every signed-in account could harvest driver phone numbers.', who;
  end if;

  raise notice 'Privacy check passed: profiles.phone is not readable by anon or authenticated.';
end $$;



-- ==========================================================================
-- PART 12 — REALTIME PUBLICATION AND CONNECTION-CHANGE NOTIFICATIONS
-- source: realtime.sql
-- ==========================================================================

-- Masaya Ako — enable LIVE updates + connection notifications. Run once. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Turn on Realtime broadcasting for the tables the app subscribes to.
--    Without this, the app only sees changes when it reloads.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'feed_posts', 'post_likes', 'post_comments', 'connections',
    'chat_messages', 'chat_threads', 'chat_thread_members',
    'worker_locations', 'notifications', 'jobs'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Notify a user when they get a connection request, and notify the
--    requester when it is accepted (Facebook-style).
-- ---------------------------------------------------------------------------
create or replace function public.notify_connection_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select coalesce(full_name, 'A driver') into who from public.profiles where id = new.requester_id;
    insert into public.notifications (id, user_id, title, description, kind, read, created_at)
    values (gen_random_uuid()::text, new.addressee_id, 'New connection request',
            who || ' wants to connect with you.', 'system', false, now());
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and coalesce(old.status, '') <> 'accepted' then
    select coalesce(full_name, 'A driver') into who from public.profiles where id = new.addressee_id;
    insert into public.notifications (id, user_id, title, description, kind, read, created_at)
    values (gen_random_uuid()::text, new.requester_id, 'Connection accepted',
            who || ' accepted your connection request.', 'system', false, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_connection_notify on public.connections;
create trigger trg_connection_notify
  after insert or update on public.connections
  for each row execute function public.notify_connection_change();



-- ==========================================================================
-- PART 13 — NOTIFICATIONS FOR MESSAGES, LIKES AND COMMENTS
-- source: notify_social.sql
-- ==========================================================================

-- Facebook-style phone notifications for messages, likes, and comments.
-- Inserts rows into public.notifications, which the app already streams in
-- realtime and turns into native device notifications (like the existing
-- connection-request notifications from realtime.sql).
--
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

-- 1. New chat message → notify every other member of the thread.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_name text;
begin
  select coalesce(full_name, 'A driver') into sender_name
  from public.profiles where id = new.sender_id;

  insert into public.notifications (id, user_id, title, description, kind, read, created_at)
  select gen_random_uuid()::text, m.user_id,
         sender_name,
         left(coalesce(new.body, 'Sent you a message'), 90),
         'chat', false, now()
  from public.chat_thread_members m
  where m.thread_id = new.thread_id
    and m.user_id <> new.sender_id;

  return new;
end;
$$;

drop trigger if exists trg_notify_new_message on public.chat_messages;
create trigger trg_notify_new_message
  after insert on public.chat_messages
  for each row execute function public.notify_new_message();

-- 2. New like → notify the post owner (never for liking your own post).
create or replace function public.notify_new_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  liker_name text;
  owner uuid;
begin
  select user_id into owner from public.feed_posts where id = new.post_id;
  if owner is null or owner = new.user_id then
    return new;
  end if;

  select coalesce(full_name, 'A driver') into liker_name
  from public.profiles where id = new.user_id;

  insert into public.notifications (id, user_id, title, description, kind, read, created_at)
  values (gen_random_uuid()::text, owner, 'New like 👍',
          liker_name || ' liked your post.', 'system', false, now());

  return new;
end;
$$;

drop trigger if exists trg_notify_new_like on public.post_likes;
create trigger trg_notify_new_like
  after insert on public.post_likes
  for each row execute function public.notify_new_like();

-- 3. New comment → notify the post owner (never for commenting on your own post).
create or replace function public.notify_new_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  commenter_name text;
  owner uuid;
begin
  select user_id into owner from public.feed_posts where id = new.post_id;
  if owner is null or owner = new.user_id then
    return new;
  end if;

  select coalesce(full_name, 'A driver') into commenter_name
  from public.profiles where id = new.user_id;

  insert into public.notifications (id, user_id, title, description, kind, read, created_at)
  values (gen_random_uuid()::text, owner, 'New comment 💬',
          commenter_name || ': ' || left(new.body, 80), 'system', false, now());

  return new;
end;
$$;

drop trigger if exists trg_notify_new_comment on public.post_comments;
create trigger trg_notify_new_comment
  after insert on public.post_comments
  for each row execute function public.notify_new_comment();



-- ==========================================================================
-- PART 14 — RECIPIENTS MAY ADVANCE A MESSAGE'S DELIVERY STATUS
-- source: read_receipts.sql
-- ==========================================================================

-- WhatsApp-style read receipts (tick progression).
-- Lets a RECIPIENT (thread member who is not the sender) update a message's
-- status: 'sent' → 'delivered' when their app fetches it, → 'read' when they
-- open the conversation. Senders then see ✓ / ✓✓ / blue ✓✓ progress live.
--
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

drop policy if exists chat_messages_update_status on public.chat_messages;
create policy chat_messages_update_status
  on public.chat_messages
  for update
  using (
    public.is_thread_member(thread_id, auth.uid())
    and sender_id <> auth.uid()
  )
  with check (
    public.is_thread_member(thread_id, auth.uid())
    and sender_id <> auth.uid()
  );



-- ==========================================================================
-- PART 15 — OBJECT-STORAGE BUCKET, ITS POLICIES, AND THE THUMBNAIL COLUMNS
-- source: photo_storage.sql
-- ==========================================================================

-- Photos out of the database and into object storage.
--
-- Until now a photo was a base64 data URL sitting in a text column. A 1280px
-- JPEG is ~359 KB binary and ~479 KB once base64 inflates it by a third, and
-- loadPosts selects image_url for up to 100 rows — so opening the Community tab
-- could pull tens of megabytes through a driver's metered mobile data, and every
-- one of those bytes also sat in the database, in every backup, and in every
-- query plan that touched the table.
--
-- After this: the row holds two short URLs. The feed loads a ~20 KB thumbnail;
-- the full image is fetched only when someone taps it.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------- bucket
-- Public read: these are already-shared community photos, and public objects
-- are served straight from the CDN with no signing round trip. Nothing private
-- goes in this bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-photos', 'post-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ------------------------------------------------------------ storage RLS
-- Objects live at  {user_id}/{uuid}.jpg  so ownership is the first path segment.
-- A driver may only write inside their own folder, which is what stops one
-- account overwriting another's photos.

drop policy if exists "post photos are readable by anyone" on storage.objects;
create policy "post photos are readable by anyone"
  on storage.objects for select
  using (bucket_id = 'post-photos');

drop policy if exists "drivers upload into their own folder" on storage.objects;
create policy "drivers upload into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "drivers replace their own photos" on storage.objects;
create policy "drivers replace their own photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "drivers delete their own photos" on storage.objects;
create policy "drivers delete their own photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------- thumbnails
-- The feed reads *_thumb_url. The full-size column keeps its name so existing
-- rows keep working: anything already holding a data: URL still renders, it is
-- simply never written again.
alter table public.feed_posts    add column if not exists image_thumb_url text;
alter table public.chat_messages add column if not exists attachment_thumb_url text;

-- ------------------------------------------------------- optional clean-up
-- Existing base64 rows keep working and the app renders them as-is. If you want
-- the storage back, this shows what they are costing before you decide:
--
--   select count(*) as base64_posts,
--          pg_size_pretty(sum(length(image_url))::bigint) as bytes_in_table
--     from public.feed_posts
--    where image_url like 'data:%';
--
-- There is no automatic backfill here on purpose: re-uploading those bytes is a
-- one-off job that belongs on a machine you control, not in a migration that
-- might run against production twice.



-- ============================================================================
-- PART 16 — HARDENING
-- ============================================================================
--
-- New. The sixteen sections above grew feature by feature, and none of them
-- went back to cover the things that only hurt once an app has real users:
-- queries without an index, text fields with no ceiling, and counters that can
-- go negative. None of this changes behaviour; it changes what happens at scale.
-- ============================================================================

-- ---------------------------------------------------------------- indexes
-- Every index below backs a query the app actually makes. Postgres will scan
-- the whole table without them, which is invisible at 50 rows and painful at
-- 500,000.

-- loadPosts fetches "which of these posts have I liked" on every feed open.
-- post_likes was indexed by post_id only, so that lookup scanned.
create index if not exists idx_post_likes_user on public.post_likes (user_id);

-- is_thread_member runs on EVERY chat row read, for both columns together.
create index if not exists idx_chat_members_thread_user
  on public.chat_thread_members (thread_id, user_id);

-- loadGroups asks for the caller's memberships.
create index if not exists idx_group_members_user on public.group_members (user_id);
create index if not exists idx_group_members_group on public.group_members (group_id);

-- A driver's own posts, for profile views and deletion.
create index if not exists idx_feed_posts_user_created
  on public.feed_posts (user_id, created_at desc);

-- Comment counts per post.
create index if not exists idx_post_comments_post_created
  on public.post_comments (post_id, created_at desc);

-- The connection lookup goes both ways: A→B and B→A.
create index if not exists idx_connections_pair
  on public.connections (requester_id, addressee_id);

-- The notification bell only ever counts UNREAD rows. A partial index stays
-- small no matter how much history accumulates.
create index if not exists idx_notifications_unread
  on public.notifications (user_id, created_at desc)
  where read = false;

-- Presence: "who is online" filters on last_seen, most recent first.
create index if not exists idx_profiles_last_seen
  on public.profiles (last_seen desc nulls last);

-- Chat list ordering.
create index if not exists idx_chat_threads_updated
  on public.chat_threads (updated_at desc);

-- ------------------------------------------------------------- size limits
-- Every one of these columns is filled by a user. Without a ceiling, one
-- account can push a single row into the megabytes — accidentally by pasting,
-- or deliberately. The limits are generous; they exist to stop abuse, not to
-- shape normal use.
--
-- Written as NOT VALID then validated, so adding them cannot lock the table
-- against live traffic, and so an existing oversized row surfaces as a clear
-- validation error rather than a failed migration.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feed_posts_body_len') then
    alter table public.feed_posts
      add constraint feed_posts_body_len check (char_length(body) <= 5000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_body_len') then
    alter table public.chat_messages
      add constraint chat_messages_body_len check (char_length(body) <= 5000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'post_comments_body_len') then
    alter table public.post_comments
      add constraint post_comments_body_len check (char_length(body) <= 2000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_full_name_len') then
    alter table public.profiles
      add constraint profiles_full_name_len check (char_length(full_name) <= 120) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'driver_settings_home_len') then
    alter table public.driver_settings
      add constraint driver_settings_home_len check (char_length(home_address) <= 300) not valid;
  end if;
end $$;

-- Validate separately: this scans without holding a write lock.
alter table public.feed_posts     validate constraint feed_posts_body_len;
alter table public.chat_messages  validate constraint chat_messages_body_len;
alter table public.post_comments  validate constraint post_comments_body_len;
alter table public.profiles       validate constraint profiles_full_name_len;
alter table public.driver_settings validate constraint driver_settings_home_len;

-- --------------------------------------------------------- sane numbers
-- Earnings and distance are written from the device. A negative distance or a
-- negative rate is not a value a driver can legitimately produce, and letting
-- one in corrupts every leaderboard that sums the column.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'worker_locations_nonneg') then
    alter table public.worker_locations
      add constraint worker_locations_nonneg check (
        coalesce(today_distance_km, 0) >= 0 and coalesce(today_earnings, 0) >= 0
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'driver_settings_rate_nonneg') then
    alter table public.driver_settings
      add constraint driver_settings_rate_nonneg check (
        coalesce(base_rate, 0) >= 0 and coalesce(daily_goal, 0) >= 0
      ) not valid;
  end if;
end $$;

alter table public.worker_locations validate constraint worker_locations_nonneg;
alter table public.driver_settings  validate constraint driver_settings_rate_nonneg;

-- ------------------------------------------------------------- statistics
-- Give the planner current statistics on everything it has just been handed.
analyze public.profiles;
analyze public.feed_posts;
analyze public.chat_messages;
analyze public.post_likes;
analyze public.post_comments;
analyze public.worker_locations;

-- ============================================================================
-- Done. To confirm what landed:
--
--   select tablename, indexname from pg_indexes
--    where schemaname = 'public' order by tablename, indexname;
--
--   select conname, conrelid::regclass as table_name, convalidated
--     from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace
--    order by table_name;
--
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' order by tablename;   -- every row must be true
-- ============================================================================



-- ============================================================================
-- PART 17 — SCHEDULED DAILY RESET  (optional, and last on purpose)
-- ============================================================================
--
-- pg_cron is not on every Supabase plan or region. Unwrapped, a failure here
-- would abort the script and take the storage bucket and all the hardening
-- above with it — so it runs last, and it swallows its own error.
--
-- source: daily_reset.sql
-- ============================================================================


-- Server-side reset of every driver's daily counters, at THEIR midnight.
--
-- The previous version fired once a day at 16:00 UTC, because that is midnight
-- in Manila. That was right when every driver was in the Philippines. It is
-- wrong now: a driver in São Paulo had their day cleared at 1pm, and one in
-- Mumbai at 9:30pm — mid-shift, with earnings on screen.
--
-- "Midnight" is not one moment across 49 countries, so the job now runs every
-- hour and resets only the drivers whose own day has actually turned over.
--
-- Run once in the SQL editor. Safe to re-run.

-- ---------------------------------------------------------------- timezone
-- The client sends an IANA name (Asia/Kolkata, America/Sao_Paulo) when it has
-- one. Rows written before this column existed simply do not have it yet.
alter table public.worker_locations add column if not exists timezone text;

-- ------------------------------------------------------------- local date
-- What calendar day was it, for this driver, at this instant?
--
-- Prefers the reported IANA zone. Falls back to longitude — the earth turns 15
-- degrees an hour — which is roughly right everywhere and exactly right nowhere,
-- but is far better than assuming Manila. An unparseable zone falls back too,
-- rather than taking the whole job down.
create or replace function public.driver_local_date(
  p_at timestamptz,
  p_timezone text,
  p_lng double precision
)
returns date
language plpgsql
immutable
as $$
begin
  if p_timezone is not null and p_timezone <> '' then
    begin
      return (p_at at time zone p_timezone)::date;
    exception when others then
      -- unknown zone name; fall through to the longitude estimate
      null;
    end;
  end if;

  return (
    p_at at time zone make_interval(
      hours => greatest(-12, least(14, round(coalesce(p_lng, 0) / 15.0)::int))
    )
  )::date;
end $$;

-- ------------------------------------------------------------------ reset
create or replace function public.reset_stale_daily_stats()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  update public.worker_locations
     set today_distance_km = 0,
         today_earnings = 0
   where (coalesce(today_distance_km, 0) <> 0 or coalesce(today_earnings, 0) <> 0)
     -- The driver's local day has moved on since their last update.
     and public.driver_local_date(now(), timezone, lng)
       > public.driver_local_date(updated_at, timezone, lng);

  get diagnostics touched = row_count;
  return touched;
end $$;

revoke all on function public.reset_stale_daily_stats() from public, anon, authenticated;

-- -------------------------------------------------------------- scheduling
-- Hourly, because every hour is midnight somewhere. Wrapped: pg_cron is not on
-- every plan, and this must never take the rest of a migration down with it.
do $$
begin
  create extension if not exists pg_cron;

  begin
    perform cron.unschedule('reset-daily-driver-stats');
  exception when others then null;
  end;

  perform cron.schedule(
    'reset-daily-driver-stats',
    '5 * * * *',                       -- five past each hour
    $job$ select public.reset_stale_daily_stats(); $job$
  );

  raise notice 'Daily reset scheduled hourly; each driver resets at their own midnight.';
exception when others then
  raise notice 'pg_cron unavailable (%). Skipping the schedule — the client-side reset still applies.', sqlerrm;
end $$;

-- Check it:
--   select jobname, schedule, active from cron.job
--    where jobname = 'reset-daily-driver-stats';
--
-- Try it by hand (returns how many drivers were reset):
--   select public.reset_stale_daily_stats();

-- ============================================================================
-- Group membership (added 2026-08-14)
-- ============================================================================
-- Adding other drivers to a group.
--
-- RLS on chat_thread_members allows `auth.uid() = user_id` only: a driver may
-- insert themselves and nobody else. That is the right default — otherwise
-- anyone could drop anyone into any thread — but it left the app unable to
-- build a group at all, which is why "New Driver Group" was always a room the
-- creator sat in alone.
--
-- So the privilege is granted here, narrowly, in a definer function that
-- enforces the two rules the policy cannot express:
--   1. the caller must already be in the thread;
--   2. every person added must be an ACCEPTED connection of the caller.
-- Without (2) this would be a way to pull strangers into a group chat.
Enforced in the database, not just the UI: the UI can be bypassed by anyone
-- calling the API directly, and an unbounded group is a way to spam every
-- driver in the app at once. Twenty is generous for a shift crew and small
-- enough that a group chat stays readable.
create or replace function public.add_group_members(p_thread uuid, p_members uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m uuid;
  current_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.chat_thread_members
     where thread_id = p_thread and user_id = auth.uid()
  ) then
    raise exception 'you are not a member of this thread';
  end if;

  foreach m in array coalesce(p_members, '{}'::uuid[]) loop
    if m <> auth.uid() then
      if not exists (
        select 1 from public.connections c
         where c.status = 'accepted'
           and ((c.requester_id = auth.uid() and c.addressee_id = m)
             or (c.requester_id = m and c.addressee_id = auth.uid()))
      ) then
        raise exception 'you can only add drivers you are connected with';
      end if;

      -- Counted inside the loop, so adding five to a group of eighteen fails on
      -- the third rather than letting all five through.
      select count(*) into current_count
        from public.chat_thread_members where thread_id = p_thread;
      if current_count >= 20 then
        raise exception 'a group can have at most 20 members';
      end if;

      insert into public.chat_thread_members (thread_id, user_id)
      values (p_thread, m)
      on conflict do nothing;
    end if;
  end loop;
end;
$$;

revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;

-- ============================================================================
-- Reels: video (added 2026-08-14)
-- ============================================================================
-- Reels need to hold video, so the bucket must accept it and posts must be able
-- to point at one.
--
-- The size limit is raised to 30 MB from 5 MB — enough for a 60-second phone
-- clip, and no more. There is no transcoding in the app, so whatever the phone
-- records is what gets uploaded; the cap is the only thing standing between a
-- driver and a very expensive upload on a metered connection.
update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg','image/png','image/webp',
         'video/mp4','video/quicktime','video/webm'
       ],
       file_size_limit = 31457280          -- 30 MB
 where id = 'post-photos';

-- A post carries either an image or a video, never both. Nullable, so every
-- existing photo post is untouched.
alter table public.feed_posts
  add column if not exists video_url text;

comment on column public.feed_posts.video_url is
  'Storage URL of a reel video. Mutually exclusive with image_url in practice; '
  'the reels list prefers video when both are somehow present.';
