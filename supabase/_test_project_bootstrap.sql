-- ============================================================================
-- Buzz Buzz TEST project bootstrap  —  for Populace runs only
-- ============================================================================
--
-- Paste this whole file into the SQL editor of the TEST project
--   https://supabase.com/dashboard/project/ypdaetbeexyepswyhbui
-- and run it once.
--
-- DO NOT run it against the live project (rqzuuvlougzhynckvqzd). It is the same
-- schema, so nothing here would destroy live data, but there is no reason to
-- touch production and Populace itself refuses to run against it.
--
-- One more step afterwards, in the dashboard:
--   Authentication -> Providers -> Email -> turn OFF "Confirm email".
-- Without that, simulated drivers sign up and can never sign in, and the run
-- reports your API as broken when the truth is a mailbox nobody is reading.
--
-- Generated from the nine files Populace's Buzz Buzz adapter depends on, in
-- dependency order.
-- ============================================================================



-- ==========================================================================
-- schema.sql
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
create policy "profiles readable" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles own write" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "settings own" on public.driver_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Honours the driver's "Share stats with community" switch. A driver can always
-- see their own row.
create policy "locations readable" on public.worker_locations
  for select using (
    auth.role() = 'authenticated'
    and (share_stats or user_id = auth.uid())
  );
create policy "locations own write" on public.worker_locations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "route own" on public.route_points for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "jobs readable" on public.jobs for select using (assigned_to is null or assigned_to = auth.uid());
create policy "jobs update assignee" on public.jobs for update using (assigned_to is null or assigned_to = auth.uid()) with check (assigned_to is null or assigned_to = auth.uid());

create policy "posts readable" on public.feed_posts
  for select using (auth.role() = 'authenticated');
create policy "posts own insert" on public.feed_posts for insert with check (auth.uid() = user_id);
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

create policy "threads member read" on public.chat_threads for select using (
  public.is_thread_member(id, auth.uid()) or created_by = auth.uid()
);
create policy "threads own insert" on public.chat_threads for insert with check (auth.uid() = created_by);
create policy "threads member update" on public.chat_threads for update
  using (public.is_thread_member(id, auth.uid()) or created_by = auth.uid())
  with check (public.is_thread_member(id, auth.uid()) or created_by = auth.uid());

create policy "members readable by members" on public.chat_thread_members for select using (
  public.is_thread_member(thread_id, auth.uid())
);
create policy "members own insert" on public.chat_thread_members for insert with check (auth.uid() = user_id);

create policy "messages member read" on public.chat_messages for select using (
  public.is_thread_member(chat_messages.thread_id, auth.uid())
);
create policy "messages member insert" on public.chat_messages for insert with check (
  auth.uid() = sender_id and
  public.is_thread_member(chat_messages.thread_id, auth.uid())
);

create policy "notifications own" on public.notifications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.device_tokens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.device_tokens enable row level security;
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
-- social_features.sql
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
-- groups.sql
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
-- direct_messages.sql
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
-- realtime.sql
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
-- fix_chat_rls.sql
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
-- user_content_control.sql
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



-- ==========================================================================
-- work_apps_global.sql
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
-- privacy_lockdown.sql
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
revoke select (phone) on public.profiles from anon;
revoke select (phone) on public.profiles from authenticated;

-- ============================================================================
-- 2. Require a logged-in session to read community data.
-- ============================================================================
drop policy if exists "profiles readable" on public.profiles;
create policy profiles_read_authenticated on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "posts readable" on public.feed_posts;
create policy feed_posts_read_authenticated on public.feed_posts
  for select using (auth.role() = 'authenticated');

drop policy if exists "likes readable" on public.post_likes;
create policy post_likes_read_authenticated on public.post_likes
  for select using (auth.role() = 'authenticated');

drop policy if exists "comments readable" on public.post_comments;
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

-- Should return NO row for 'phone' (anon/authenticated can no longer select it).
select grantee, privilege_type, column_name
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name = 'profiles'
   and column_name = 'phone'
   and grantee in ('anon','authenticated');
