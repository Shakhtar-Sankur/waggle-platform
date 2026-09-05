-- Saved posts.
--
-- The community feed carries things a driver wants to come back to — a parking
-- spot near a mall gate, which gate at BKC is open this week, a surge pattern
-- someone worked out. Until now the only way to keep one was to remember it,
-- and the feed is newest-first, so remembering meant scrolling.
--
-- Shaped exactly like post_likes: a junction table keyed on the pair, so saving
-- twice is impossible by construction rather than by a check in the client.

create table if not exists public.post_bookmarks (
  post_id    uuid not null references public.feed_posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- "What have I saved, newest first" is the only query this table serves, and
-- the primary key leads on post_id, which Postgres cannot use for a lookup by
-- user alone. Same gap user_content_control.sql fixed for group_members.
create index if not exists idx_post_bookmarks_user
  on public.post_bookmarks (user_id, created_at desc);

alter table public.post_bookmarks enable row level security;

-- Your saves, and only yours. Deliberately not readable by the post's author:
-- a bookmark is a private note to yourself, not a public signal like a like.
-- That is also why there is no count anywhere in the app.
drop policy if exists post_bookmarks_own on public.post_bookmarks;
create policy post_bookmarks_own on public.post_bookmarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.post_bookmarks is
  'Posts a driver saved for later. Private to the saver — the author is not told and no count is shown, which is what separates it from a like.';
