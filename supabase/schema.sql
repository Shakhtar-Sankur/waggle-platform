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
