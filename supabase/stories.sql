-- Stories: a picture that expires on its own after twenty-four hours.
--
-- A separate table rather than a flag on feed_posts. The two behave nothing
-- alike: a post is permanent, is listed newest-first forever, and carries
-- likes, comments and reposts; a story exists for a day, is grouped by its
-- author, and tracks who has seen it. Bolting an `is_story` column onto
-- feed_posts would put `expires_at is null or expires_at > now()` into every
-- feed query in the app, and the first one that forgot it would leak an expired
-- story into the permanent feed.

create table if not exists public.stories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  image_url       text not null,
  image_thumb_url text,
  caption         text,
  created_at      timestamptz not null default now(),
  -- Stored, not computed on read. A story must expire twenty-four hours after
  -- it was POSTED, and a `created_at + interval` in a view would quietly change
  -- meaning the day someone decides stories last twelve hours or forty-eight —
  -- old rows would retroactively expire or un-expire. Writing the deadline down
  -- means a story's lifetime is fixed the moment it is created.
  expires_at      timestamptz not null default now() + interval '24 hours'
);

alter table public.stories
  drop constraint if exists stories_caption_len;
alter table public.stories
  add constraint stories_caption_len check (caption is null or char_length(caption) <= 200);

-- The only query this table serves: unexpired stories, newest first.
create index if not exists idx_stories_live on public.stories (expires_at, created_at desc);
create index if not exists idx_stories_user on public.stories (user_id, created_at desc);

-- Who has seen what, so a ring can be drawn solid or hollow.
create table if not exists public.story_views (
  story_id  uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

create index if not exists idx_story_views_viewer on public.story_views (viewer_id);

alter table public.stories     enable row level security;
alter table public.story_views enable row level security;

/* Same visibility rule as feed_posts: any authenticated driver may read, only
   the author may write or remove. Locations are the thing this app gates on a
   mutual connection; posts are not, and a story is a post that expires.

   The expiry lives in the READ policy rather than in application code. A story
   whose time is up becomes invisible to Postgres itself, so a client that
   forgets the filter — or an old build still on someone's phone — cannot show
   it. Deleting the row is then only housekeeping, not the thing that enforces
   the promise. */
drop policy if exists "stories readable while live" on public.stories;
create policy "stories readable while live" on public.stories
  for select using (auth.role() = 'authenticated' and expires_at > now());

drop policy if exists "stories insert own" on public.stories;
create policy "stories insert own" on public.stories
  for insert with check (auth.uid() = user_id);

drop policy if exists "stories delete own" on public.stories;
create policy "stories delete own" on public.stories
  for delete using (auth.uid() = user_id);

-- No update policy at all. A story is not editable: it is posted, it is seen,
-- it goes. Anything else needs a new story, which is also what the interface
-- offers, so there is nothing for an UPDATE to legitimately do.

drop policy if exists "story views readable" on public.story_views;
create policy "story views readable" on public.story_views
  for select using (auth.role() = 'authenticated');

/* You may only record that YOU saw something. Without the viewer_id check any
   driver could write rows claiming anyone had seen anything, which turns the
   seen/unseen ring into something a stranger controls. */
drop policy if exists "story views insert own" on public.story_views;
create policy "story views insert own" on public.story_views
  for insert with check (auth.uid() = viewer_id);

/* Housekeeping. The read policy already hides expired stories, so this is about
   not keeping pictures — and the storage they occupy — after the promise that
   they would disappear. Call it from the same daily job as daily_reset.sql.

   SECURITY DEFINER because it runs as a schedule, not as a signed-in driver,
   and the delete policy above would otherwise let it remove only its own. */
create or replace function public.purge_expired_stories()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
  delete from public.stories where expires_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_stories() from public, anon, authenticated;
