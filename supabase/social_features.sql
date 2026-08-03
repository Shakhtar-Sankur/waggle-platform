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
