-- Reposts — a driver passing someone else's post on to their own followers
--
-- Modelled exactly on post_likes: a join table keyed by (post_id, user_id), so
-- reposting twice is impossible by construction rather than by a check in the
-- app. Removing the repost is a delete of your own row.
--
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

create table if not exists public.post_reposts (
  post_id uuid not null references public.feed_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.post_reposts enable row level security;

-- Same visibility rule as the rest of the community: signed in, or nothing.
drop policy if exists reposts_read_authenticated on public.post_reposts;
create policy reposts_read_authenticated on public.post_reposts
  for select using (auth.role() = 'authenticated');

-- You may only repost as yourself, and only undo your own.
drop policy if exists reposts_own_insert on public.post_reposts;
create policy reposts_own_insert on public.post_reposts
  for insert with check (auth.uid() = user_id);

drop policy if exists reposts_own_delete on public.post_reposts;
create policy reposts_own_delete on public.post_reposts
  for delete using (auth.uid() = user_id);

-- Note there is deliberately no UPDATE policy. post_likes has none either, and
-- the absence is the point: an upsert on a table with no UPDATE policy is what
-- caused three separate defects in this app (likes, profile edits, group joins).
-- Insert and delete are the only operations this table ever needs.

-- Counting reposts for a post, and listing what one driver reposted.
create index if not exists idx_post_reposts_post on public.post_reposts (post_id);
create index if not exists idx_post_reposts_user_created
  on public.post_reposts (user_id, created_at desc);

-- Realtime. The app subscribes to post_reposts so a repost appears for everyone
-- without a reload, exactly as a like does. A subscription to a table that is
-- not in the publication is silently dead — it connects, and no event ever
-- arrives — so the table has to be added here as well as in realtime.sql.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'post_reposts'
  ) then
    alter publication supabase_realtime add table public.post_reposts;
  end if;
end $$;

-- Verify:
--   select post_id, count(*) from public.post_reposts group by post_id;
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'post_reposts';
