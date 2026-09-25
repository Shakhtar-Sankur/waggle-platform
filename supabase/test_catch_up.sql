-- ============================================================================
-- TEST project catch-up (jqepegeifmnfofeyebrz ONLY). Generated September 24, 2026.
-- The 11 updates the TEST project missed, then waggle_gig_setup.sql, then
-- security_fixes.sql, in dependency order. Every part is safe to run again.
-- Do NOT run this on production: production already has all of it except
-- security_fixes.sql, which is run there on its own.
-- ============================================================================


-- ############################################################################
-- ##  report_and_block.sql
-- ############################################################################

-- Reporting and blocking.
--
-- Google Play's User Generated Content policy requires that an app carrying
-- user content give people an in-app way to report objectionable content AND to
-- block other users. Waggle has a public feed, group chat, direct messages,
-- photos and voice notes, and had neither. What existed was "hide post", which
-- only hid it locally — everyone else still saw it — and deleting your OWN
-- content, which is not moderation at all.
--
-- Two tables, because they answer different questions. A report is a message to
-- the operator about a thing; a block is a standing instruction about a person,
-- and it takes effect for the blocker immediately without anyone reviewing it.

-- ── reports ────────────────────────────────────────────────────────────────
create table if not exists public.content_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  -- What is being reported. Deliberately not a foreign key: a post can be
  -- deleted after it is reported, and the report has to survive that — it is
  -- the record of the complaint, not a pointer to live content.
  target_type  text not null check (target_type in ('post', 'message', 'user')),
  target_id    text not null,
  -- Who posted it, kept so repeated reports about one person can be counted
  -- without joining back to content that may be gone.
  target_user  uuid references public.profiles(id) on delete set null,
  reason       text not null check (reason in
                 ('spam', 'harassment', 'hate', 'violence', 'sexual', 'other')),
  note         text check (note is null or char_length(note) <= 1000),
  -- A snapshot of the reported text. Without it, a report about a message the
  -- sender then deletes arrives with nothing to look at.
  excerpt      text check (excerpt is null or char_length(excerpt) <= 500),
  status       text not null default 'open' check (status in ('open', 'reviewed', 'actioned')),
  created_at   timestamptz not null default now(),
  -- One report per person per thing. Re-reporting the same post is not more
  -- signal, and without this a rage-tap sends twenty rows.
  unique (reporter_id, target_type, target_id)
);

create index if not exists idx_content_reports_open
  on public.content_reports (created_at desc) where status = 'open';
create index if not exists idx_content_reports_target_user
  on public.content_reports (target_user) where target_user is not null;

alter table public.content_reports enable row level security;

-- A reporter may file, and may see what they filed. Nobody reads anyone else's
-- reports through this API: triage happens in the dashboard, under the service
-- role, so a curious user cannot enumerate who reported whom.
drop policy if exists content_reports_insert_own on public.content_reports;
create policy content_reports_insert_own on public.content_reports
  for insert with check (auth.uid() = reporter_id);

drop policy if exists content_reports_read_own on public.content_reports;
create policy content_reports_read_own on public.content_reports
  for select using (auth.uid() = reporter_id);

-- ── blocks ─────────────────────────────────────────────────────────────────
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  -- Blocking yourself is not a thing, and it would hide your own posts.
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists idx_user_blocks_blocker on public.user_blocks (blocker_id);

alter table public.user_blocks enable row level security;

-- You manage your own block list, and you can read only your own. Deliberately
-- NOT readable by the blocked party: telling someone they have been blocked is
-- how a block turns into an escalation.
drop policy if exists user_blocks_manage_own on public.user_blocks;
create policy user_blocks_manage_own on public.user_blocks
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

comment on table public.content_reports is
  'User reports of objectionable posts, messages or people. Required by Play''s UGC policy. Triage under the service role.';
comment on table public.user_blocks is
  'Per-user block list. Blocked people''s posts, comments and messages are filtered client-side and their content is not shown to the blocker.';


-- ############################################################################
-- ##  stories.sql
-- ############################################################################

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


-- ############################################################################
-- ##  group_rooms.sql
-- ############################################################################

-- Give every group a room to be in.
--
-- Before this, joining a group wrote a membership row and changed a button to
-- "Joined". That was the whole feature: no group feed, no group chat, nowhere
-- to go. The only way to reach an actual community was the "Find on Facebook"
-- link, which sends the driver out of the app to somebody else's product.
--
-- A group is now backed by one chat thread, so joining puts the driver in a
-- room with the other members and leaving takes them out of it. This reuses the
-- chat machinery that already exists and is already tested — messages, read
-- receipts, reactions, voice notes — rather than inventing a second kind of
-- conversation.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table public.chat_threads
  add column if not exists group_id text references public.groups(id) on delete cascade;

-- One room per group. This is also the race guard: two drivers tapping Join at
-- the same moment both find no thread and both try to create one, and the
-- loser gets 23505 rather than a second room nobody else is in.
create unique index if not exists chat_threads_group_id_key
  on public.chat_threads (group_id)
  where group_id is not null;

-- Finding the room is the part RLS does not give you for free. "threads member
-- read" only lets you see a thread you are already in, which is exactly what a
-- driver joining a group is not — so without this they would never see the
-- existing room and would create a duplicate.
--
-- Membership in the GROUP is what grants sight of the group's thread. joinGroup
-- writes the group_members row first, so by the time it looks for the room this
-- policy already passes for them.
drop policy if exists "threads group read" on public.chat_threads;
create policy "threads group read" on public.chat_threads
  for select using (
    group_id is not null
    and exists (
      select 1 from public.group_members m
      where m.group_id = chat_threads.group_id
        and m.user_id = auth.uid()
    )
  );

-- Same reasoning for the member list: you should be able to see who else is in
-- the room once you are in the group, which the existing "readable by members"
-- policy cannot tell you until you are already a thread member.
drop policy if exists "members readable by group" on public.chat_thread_members;
create policy "members readable by group" on public.chat_thread_members
  for select using (
    exists (
      select 1 from public.chat_threads t
      join public.group_members m on m.group_id = t.group_id
      where t.id = chat_thread_members.thread_id
        and m.user_id = auth.uid()
    )
  );

-- Leaving a group has to remove the driver from the room as well. The existing
-- chat_members_leave policy already allows deleting your own membership row,
-- so the client does both halves; this index just keeps that delete cheap.
create index if not exists idx_chat_thread_members_user
  on public.chat_thread_members (user_id);


-- ############################################################################
-- ##  chat_reply_reactions.sql
-- ############################################################################

-- Reply-to and reactions for chat messages.
--
-- Two of the three things that make WhatsApp feel like WhatsApp and were
-- missing here. The third, typing, needs no schema — it is presence, not data.
--
-- Safe to run more than once, like every other migration in this folder.

-- ── replying to a message ────────────────────────────────────────────────
-- `on delete set null` rather than cascade: deleting a message must not delete
-- the replies to it. The quote disappears and the reply survives, which is what
-- a reader expects and what every chat app does.
alter table public.chat_messages
  add column if not exists reply_to text references public.chat_messages(id) on delete set null;

create index if not exists idx_chat_messages_reply_to
  on public.chat_messages (reply_to) where reply_to is not null;

-- ── reactions ────────────────────────────────────────────────────────────
-- A row per person per message, not a JSON blob on the message: two people
-- reacting at the same moment would otherwise overwrite each other, and a blob
-- cannot express "this person may remove only their own".
create table if not exists public.message_reactions (
  message_id text not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  -- One reaction per person per message. Tapping a different emoji replaces
  -- theirs rather than adding a second, which is how WhatsApp behaves.
  primary key (message_id, user_id)
);

create index if not exists idx_message_reactions_message
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- Readable by anyone who can see the thread the message belongs to. The
-- membership check is the same one the messages themselves use, so a reaction
-- can never be more visible than the message it is attached to.
drop policy if exists "reactions readable by thread members" on public.message_reactions;
create policy "reactions readable by thread members"
  on public.message_reactions for select
  using (
    exists (
      select 1
      from public.chat_messages m
      join public.chat_thread_members tm on tm.thread_id = m.thread_id
      where m.id = message_reactions.message_id
        and tm.user_id = auth.uid()
    )
  );

-- Writable only as yourself, and only into a thread you are in. Both halves
-- matter: without the membership check a driver could react to a stranger's
-- message by guessing an id, and without the uid check they could react as
-- somebody else.
drop policy if exists "reactions writable by the reactor" on public.message_reactions;
create policy "reactions writable by the reactor"
  on public.message_reactions for all
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.chat_messages m
      join public.chat_thread_members tm on tm.thread_id = m.thread_id
      where m.id = message_reactions.message_id
        and tm.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.chat_messages m
      join public.chat_thread_members tm on tm.thread_id = m.thread_id
      where m.id = message_reactions.message_id
        and tm.user_id = auth.uid()
    )
  );


-- ############################################################################
-- ##  chat_voice_notes.sql
-- ############################################################################

-- Voice notes on chat messages.
--
-- Separate columns rather than reusing attachment_url: a client that finds a
-- URL there today renders an <img>, and an audio file in an image tag is a
-- broken-picture icon, not a playable note. Old clients should see a message
-- with no attachment, which is wrong but harmless, rather than a broken one.

alter table public.chat_messages
  add column if not exists voice_url text,
  add column if not exists voice_seconds numeric,
  -- The waveform is drawn from levels captured while recording. Storing them
  -- means the bubble draws instantly instead of downloading and decoding the
  -- audio to find its shape — on a driver's connection that is the difference
  -- between a chat that renders and one that hangs.
  add column if not exists voice_levels jsonb;

-- A note longer than the recorder's own ceiling means the client was bypassed.
alter table public.chat_messages
  drop constraint if exists chat_messages_voice_len;
alter table public.chat_messages
  add constraint chat_messages_voice_len
  check (voice_seconds is null or (voice_seconds > 0 and voice_seconds <= 180));

-- Audio lives in its own bucket, so a storage policy for pictures can never
-- accidentally decide who may hear a private conversation.
insert into storage.buckets (id, name, public)
values ('chat-voice', 'chat-voice', true)
on conflict (id) do nothing;

-- Anyone may read (the URL is unguessable and the bucket is public, matching
-- how photos already work), but you may only write into your own folder.
drop policy if exists "voice upload own" on storage.objects;
create policy "voice upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "voice read" on storage.objects;
create policy "voice read" on storage.objects
  for select using (bucket_id = 'chat-voice');

drop policy if exists "voice delete own" on storage.objects;
create policy "voice delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ############################################################################
-- ##  chat_thread_atomic.sql
-- ############################################################################

-- Creating a chat thread, atomically.
--
-- It used to be two round trips from the client: insert the thread, then insert
-- the creator's membership row. Anything failing between them — a dropped
-- connection, an RLS rejection, the process being killed — left a thread with
-- no members.
--
-- That is not merely untidy. Every policy on chat_threads and chat_messages
-- gates on membership, so a thread nobody belongs to is invisible to every
-- client: it cannot be listed, opened, joined or deleted through the app, ever.
-- It is unreachable data that only accumulates.
--
-- A local database carrying load-test traffic had 290,934 of them against 12
-- real ones. The tests were killed mid-run, which is exactly the failure this
-- shape produces.
--
-- A plpgsql function runs inside a single transaction, so if the membership
-- insert raises, the thread insert rolls back with it. One statement from the
-- client's point of view, and no state in between for a failure to strand.
--
-- Safe to run more than once, like every other migration in this folder.

create or replace function public.create_thread(
  p_title text,
  p_is_group boolean default false
)
returns table (id uuid, title text, is_group boolean, updated_at timestamptz)
language plpgsql
-- SECURITY DEFINER because chat_thread_members' insert policy only permits
-- `auth.uid() = user_id`, which is satisfied here, but the function also needs
-- to write the thread row it has only just created and cannot yet be a member
-- of. auth.uid() is still what decides who the row belongs to — the definer
-- rights do not let a caller create a thread as somebody else.
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.chat_threads (title, is_group, created_by)
  values (nullif(btrim(p_title), ''), coalesce(p_is_group, false), v_uid)
  returning chat_threads.id into v_id;

  insert into public.chat_thread_members (thread_id, user_id)
  values (v_id, v_uid);

  return query
    select t.id, t.title, t.is_group, t.updated_at
    from public.chat_threads t
    where t.id = v_id;
end;
$$;

grant execute on function public.create_thread(text, boolean) to authenticated;

-- ── Sweeping up what the old shape left behind ───────────────────────────
--
-- Only threads with no members AND no messages, and only ones older than an
-- hour. The age check is the important one: without it this would race a thread
-- being created right now, between its two inserts, on a client that has not
-- been updated yet. An hour is far longer than that window and far shorter than
-- anything worth keeping.
--
-- Written as a function rather than a bare DELETE so it is not run by accident
-- simply by applying the file, and so it can be scheduled later if wanted.
create or replace function public.prune_orphan_threads()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  with gone as (
    delete from public.chat_threads t
    where t.created_at < now() - interval '1 hour'
      and not exists (select 1 from public.chat_thread_members m where m.thread_id = t.id)
      and not exists (select 1 from public.chat_messages msg where msg.thread_id = t.id)
    returning 1
  )
  select count(*) into v_deleted from gone;
  return v_deleted;
end;
$$;

revoke all on function public.prune_orphan_threads() from public, anon, authenticated;


-- ############################################################################
-- ##  chat_favourites.sql
-- ############################################################################

-- Favourite chats, so they follow the driver rather than the handset.
--
-- They started in local storage, which works and survives a reload but not a
-- new phone — and a driver who replaces a cracked handset should not have to
-- rebuild the short list of people they talk to most. Post bookmarks already
-- live on the server; this is the same idea about a thread.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists public.chat_favourites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

alter table public.chat_favourites enable row level security;

-- Nobody else's business. A favourite says who you talk to most, which is the
-- kind of thing that should not be readable across accounts even inside one
-- co-operative: the whole table is scoped to the caller, in every direction.
drop policy if exists chat_favourites_read on public.chat_favourites;
create policy chat_favourites_read on public.chat_favourites
  for select using (auth.uid() = user_id);

drop policy if exists chat_favourites_add on public.chat_favourites;
create policy chat_favourites_add on public.chat_favourites
  for insert with check (auth.uid() = user_id);

drop policy if exists chat_favourites_remove on public.chat_favourites;
create policy chat_favourites_remove on public.chat_favourites
  for delete using (auth.uid() = user_id);

-- The lookup the app makes on every chat-list render is "which of mine",
-- so the index leads with the user.
create index if not exists idx_chat_favourites_user
  on public.chat_favourites (user_id, created_at desc);


-- ############################################################################
-- ##  bookmarks.sql
-- ############################################################################

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


-- ############################################################################
-- ##  notification_prefs.sql
-- ############################################################################

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


-- ############################################################################
-- ##  driver_currency.sql
-- ############################################################################

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


-- ############################################################################
-- ##  route_daily_distance.sql
-- ############################################################################

-- Per-day distance, computed in the database instead of on the phone.
--
-- The 7-day record and the earnings report used to fetch raw route_points and
-- add them up in the client. That works on a test account and fails on a real
-- driver, badly enough to be worth spelling out:
--
--   TripTrackingService emits a fix every 2 seconds while moving, and every
--   accepted fix writes one row. An 8-hour shift is ~14,400 rows a day, so a
--   month of work is ~430,000 rows. The client query capped at 20,000 and
--   ordered ASCENDING, so it returned the OLDEST 20,000 rows in the window —
--   about a day and a half from four weeks ago — and the last seven days came
--   back empty. Seeded with six realistic shifts, the app reported 6.9 km for
--   the week and 0.0 km for six days out of seven, today included.
--
--   Raising the cap is not the fix. Pulling 430,000 rows to a handset is the
--   opposite of what this app is for: it is built for a mid-range phone on a
--   prepaid plan. The right answer is to send back seven numbers.
--
-- The distance rules are the ones LocationService.routeDistanceKm applies, and
-- they have to stay that way or the map and the record will disagree about the
-- same day:
--
--   * a segment spanning more than SESSION_GAP_MS (5 minutes) is a gap between
--     two shifts, not a drive across town, so it is skipped;
--   * a segment implying more than MAX_PLAUSIBLE_KMH (200) is a GPS glitch
--     inside one session, so it is skipped;
--   * everything else counts.
--
-- Days are bucketed in the DRIVER's timezone, passed in by the caller, because
-- "how far did I go on Tuesday" means their Tuesday. Bucketing in UTC would
-- move part of every evening shift into the next day for anyone east of London.
--
-- SECURITY INVOKER, deliberately: the function runs as the caller, so the
-- existing row-level policy on route_points ("route own", auth.uid() =
-- user_id) is what keeps one driver's history out of another's totals. A
-- SECURITY DEFINER function here would bypass that policy and rely on this
-- file getting its own filter right, forever.

create or replace function public.route_daily_distance(
  days int default 30,
  tz   text default 'UTC'
)
returns table (day date, km double precision)
language sql
stable
security invoker
set search_path = public
as $$
  with fixes as (
    select
      recorded_at,
      lat,
      lng,
      lag(lat)         over (order by recorded_at) as prev_lat,
      lag(lng)         over (order by recorded_at) as prev_lng,
      lag(recorded_at) over (order by recorded_at) as prev_at
    from route_points
    -- RLS already restricts this to the caller; the date bound is what keeps
    -- the scan small, and it matches the window the caller asked for.
    where recorded_at >= (now() - make_interval(days => days))
  ),
  segments as (
    select
      (recorded_at at time zone tz)::date as day,
      extract(epoch from (recorded_at - prev_at)) as seconds,
      case
        when prev_lat is null then 0
        else 2 * 6371.0088 * asin(least(1, sqrt(
               power(sin(radians(lat - prev_lat) / 2), 2)
             + cos(radians(prev_lat)) * cos(radians(lat))
             * power(sin(radians(lng - prev_lng) / 2), 2)
           )))
      end as km
    from fixes
  )
  select
    day,
    coalesce(sum(km) filter (
      where seconds is not null
        and seconds > 0
        and seconds <= 300                      -- SESSION_GAP_MS
        and km / (seconds / 3600.0) <= 200      -- MAX_PLAUSIBLE_KMH
    ), 0)::double precision as km
  from segments
  group by day
  order by day;
$$;

-- `least(1, ...)` above is not decoration: floating point can push the haversine
-- argument a hair over 1 for two fixes at the same spot, and asin() of 1.0000001
-- raises "input is out of range", which would fail the whole query for a driver
-- whose phone reported the identical position twice.

comment on function public.route_daily_distance(int, text) is
  'Per-day driving distance in km for the calling driver, bucketed in the given timezone. Applies the same session-gap and speed filters as LocationService.routeDistanceKm.';

grant execute on function public.route_daily_distance(int, text) to authenticated;


-- ############################################################################
-- ##  waggle_gig_setup.sql
-- ############################################################################

-- ============================================================================
-- Waggle Gig: dispatch, nearby jobs and online availability.
-- Paste the whole file into the Supabase SQL Editor and press Run, once.
-- Order matters and is already correct. Safe to run again.
-- Needs 00_complete_backend.sql to have been run first (the jobs table).
-- ============================================================================

-- Dispatch: a merchant can send a job, and a job can only be accepted once.
--
-- Run after 00_complete_backend.sql. Safe to re-run.
--
-- Two things are added here:
--   1. Jobs get an author (created_by) and Waggle's own routing fee, so the
--      platform fee is recorded on the job it was charged for. Money that moves
--      between the customer and the driver is deliberately NOT modelled here:
--      Waggle's income is the fee, not the fare.
--   2. Accepting is moved into a function and the update policy is narrowed, so
--      two drivers pressing Accept in the same second cannot both get the job.
--      Before this, the policy allowed any authenticated driver to update any
--      unassigned job, and the second write simply overwrote the first.

alter table public.jobs add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.jobs add column if not exists fee_paise integer not null default 0;
alter table public.jobs add column if not exists note text;
alter table public.jobs add column if not exists accepted_at timestamptz;

create index if not exists idx_jobs_created_by on public.jobs (created_by);

-- A merchant keeps sight of the job after a driver takes it; a driver still
-- sees open jobs and their own.
drop policy if exists "jobs readable" on public.jobs;
create policy "jobs readable" on public.jobs
  for select to authenticated using (
    assigned_to is null
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  );

-- No one may post a job directly yet. Jobs will be created by Waggle Business
-- through a function that checks the business, once businesses exist as a role.
-- (An earlier version let any signed-in account post jobs; it was removed on
-- September 23, 2026, and this line keeps it removed on every re-run.)
drop policy if exists "jobs insert own" on public.jobs;

-- Narrowed: you may change a job you already hold, or one you created.
-- Claiming an unassigned job is no longer possible with a plain update — it
-- goes through accept_job() below, which is the only place the claim happens.
drop policy if exists "jobs update assignee" on public.jobs;
create policy "jobs update assignee" on public.jobs
  for update using (assigned_to = auth.uid() or created_by = auth.uid())
  with check (assigned_to = auth.uid() or created_by = auth.uid());

-- First accept wins.
--
-- The WHERE clause carries the whole rule: the row is only updated while it is
-- still open and unassigned. Postgres takes a row lock for the update, so the
-- second caller waits, re-reads the row, finds status = 'accepted' and matches
-- nothing. It returns no row, and the app tells that driver the job is gone
-- rather than sending two people to one pickup.
create or replace function public.accept_job(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.jobs;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  update public.jobs
     set status = 'accepted',
         assigned_to = auth.uid(),
         accepted_at = now(),
         updated_at = now()
   where id = p_job_id
     and status = 'open'
     and assigned_to is null
  returning * into claimed;

  return claimed;   -- null when somebody else got there first
end;
$$;

revoke all on function public.accept_job(uuid) from public, anon;
grant execute on function public.accept_job(uuid) to authenticated;


-- Jobs near the driver, and nothing else.
--
-- Run after dispatch.sql. Safe to re-run.
--
-- Until now loadJobs() returned every unassigned job in the table, so a rider
-- in Bhubaneswar was offered a parcel in Mumbai. A job now carries the
-- coordinates of its pick-up, and drivers ask for the ones within a radius of
-- where they are.
--
-- No PostGIS: this is a plain haversine in SQL. A bounding box on latitude
-- narrows the rows first so the index does the work and the trigonometry only
-- runs on what survives. At city scale that is fast enough, and it keeps the
-- schema portable to any Postgres.

alter table public.jobs add column if not exists pickup_lat double precision;
alter table public.jobs add column if not exists pickup_lng double precision;

create index if not exists idx_jobs_open_pickup on public.jobs (status, pickup_lat, pickup_lng)
  where status = 'open' and assigned_to is null;

/** Great-circle distance in kilometres. */
create or replace function public.km_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
parallel safe
as $$
  select 2 * 6371 * asin(
    sqrt(
      sin(radians(lat2 - lat1) / 2) ^ 2
      + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
    )
  );
$$;

/**
 * Open jobs whose pick-up is within p_radius_km of the driver, nearest first.
 *
 * SECURITY INVOKER on purpose: the caller's own row-level security still
 * applies, so this cannot be used to read jobs somebody else already holds.
 * Jobs with no coordinates are left out rather than shown to everyone — a job
 * with an unknown pick-up is exactly the one a driver should not be sent to.
 */
create or replace function public.jobs_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 12,
  p_limit integer default 50
)
returns table (job public.jobs, distance_km double precision)
language sql
stable
as $$
  select j, public.km_between(p_lat, p_lng, j.pickup_lat, j.pickup_lng) as distance_km
    from public.jobs j
   where j.status = 'open'
     and j.assigned_to is null
     and j.pickup_lat is not null
     and j.pickup_lng is not null
     -- cheap box first: one degree of latitude is ~111 km everywhere
     and j.pickup_lat between p_lat - (p_radius_km / 111.0) and p_lat + (p_radius_km / 111.0)
     and public.km_between(p_lat, p_lng, j.pickup_lat, j.pickup_lng) <= p_radius_km
   order by distance_km
   limit p_limit;
$$;

revoke all on function public.jobs_nearby(double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.jobs_nearby(double precision, double precision, double precision, integer) to authenticated;
grant execute on function public.km_between(double precision, double precision, double precision, double precision) to authenticated;


-- Online / offline: which workers are available for a job, and where they are.
--
-- Run after dispatch_nearby.sql. Safe to re-run.
--
-- Kept apart from worker_locations on purpose. That table is the social map —
-- where a driver is for their friends, while they choose to share it. This one
-- is operational: a worker who is online is asking to be offered work, and
-- dispatch needs to know where they are to do that. The two are different
-- consents, and one switch should not quietly turn on the other.
--
-- Only the worker can read or write their own row. Nobody browses who is online;
-- the future dispatch function reads this table as the database, not as a user.

create table if not exists public.worker_availability (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  online boolean not null default false,
  lat double precision,
  lng double precision,
  online_since timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_worker_availability_online
  on public.worker_availability (online, updated_at desc)
  where online;

alter table public.worker_availability enable row level security;

drop policy if exists "availability own read" on public.worker_availability;
create policy "availability own read" on public.worker_availability
  for select using (user_id = auth.uid());

drop policy if exists "availability own insert" on public.worker_availability;
create policy "availability own insert" on public.worker_availability
  for insert with check (user_id = auth.uid());

drop policy if exists "availability own update" on public.worker_availability;
create policy "availability own update" on public.worker_availability
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A worker who closes the app without going offline must not stay "available"
-- for ever. Anything not refreshed in 15 minutes is treated as offline by
-- whatever reads this table; the app refreshes the row while it is open.
create or replace view public.workers_available as
  select user_id, lat, lng, online_since, updated_at
    from public.worker_availability
   where online
     and updated_at > now() - interval '15 minutes'
     and lat is not null
     and lng is not null;

revoke all on public.workers_available from anon, authenticated;


-- ############################################################################
-- ##  security_fixes.sql
-- ############################################################################

-- ============================================================================
-- Waggle Gig: the launch security gate.
--
-- Closes the permission flaws the attack suite (rls-attack.mjs) found in the
-- database rules, and the new ones the dispatch features could have opened.
-- Run AFTER waggle_gig_setup.sql. Safe to run again.
--
-- Every fix is tested against a local database by the attack suite before it
-- is run anywhere else. Each block names the check it closes.
--
-- The pattern for "who may change which column" is a BEFORE UPDATE trigger,
-- because row-level security can say which rows a person may touch but not
-- which columns. The triggers step aside when auth.uid() is null: that is the
-- service role and the database's own jobs, which must keep working.
-- ============================================================================


-- S3 — a stranger could add themselves to someone else's private chat and read it.
--
-- Joining a thread directly is now allowed in only two cases: the thread is one
-- you created (the app's fallback when create_thread is missing), or it is a
-- group's room and you are a member of that group. Direct chats are created by
-- start_direct_thread(), which runs as the database and is unaffected.

create or replace function public.can_join_thread(p_thread uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.chat_threads t
     where t.id = p_thread
       and (
         t.created_by = p_user
         or (t.group_id is not null and exists (
               select 1 from public.group_members gm
                where gm.group_id = t.group_id and gm.user_id = p_user))
       )
  );
$$;

revoke all on function public.can_join_thread(uuid, uuid) from public, anon;
grant execute on function public.can_join_thread(uuid, uuid) to authenticated;

drop policy if exists "members own insert" on public.chat_thread_members;
drop policy if exists "members join allowed threads" on public.chat_thread_members;
create policy "members join allowed threads" on public.chat_thread_members
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_join_thread(thread_id, auth.uid()));


-- S4, S5 — a chat partner could rewrite someone else's message, or say it came
-- from a third person.
--
-- The only change anyone but the database may make to a message is its delivery
-- status, and that only moves forward: sent, delivered, read.

create or replace function public.guard_chat_message_update()
returns trigger
language plpgsql
as $$
declare
  rank_old int := case old.status when 'read' then 3 when 'delivered' then 2 else 1 end;
  rank_new int := case new.status when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end;
begin
  if auth.uid() is null then
    return new;
  end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Only the delivery status of a message can change' using errcode = '42501';
  end if;
  if rank_new = 0 then
    raise exception 'Unknown message status %', new.status using errcode = '22023';
  end if;
  if rank_new < rank_old then
    new.status := old.status;   -- a late "delivered" never un-reads a message
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_chat_message_update on public.chat_messages;
create trigger trg_guard_chat_message_update
  before update on public.chat_messages
  for each row execute function public.guard_chat_message_update();


-- S6 — a chat partner could change who created a thread, and rename it.
--
-- Who made a thread, when, and whether it is a group never change. Only its
-- creator renames it, and only its creator links it to a group, once. Any
-- member may still bump updated_at, which is how the chat list is ordered.

create or replace function public.guard_chat_thread_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.is_group is distinct from old.is_group then
    raise exception 'A thread''s creator and type cannot change' using errcode = '42501';
  end if;
  if new.title is distinct from old.title and old.created_by is distinct from auth.uid() then
    raise exception 'Only the person who started this chat can rename it' using errcode = '42501';
  end if;
  if new.group_id is distinct from old.group_id
     and not (old.group_id is null and old.created_by = auth.uid()) then
    raise exception 'Only the creator can link a chat to a group, once' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_chat_thread_update on public.chat_threads;
create trigger trg_guard_chat_thread_update
  before update on public.chat_threads
  for each row execute function public.guard_chat_thread_update();


-- S7 — a stranger could read a driver's exact live position.
--
-- Stats a driver chooses to share (distance, earnings, the app they are on)
-- stay visible to other signed-in drivers. The coordinates do not: they are no
-- longer readable from the table at all, and come only from friend_positions(),
-- which returns your own position and those of accepted friends who share.

revoke select on public.worker_locations from anon, authenticated;
grant select (user_id, accuracy, active_app, today_distance_km, today_earnings, rating, tags, updated_at, share_stats, timezone)
  on public.worker_locations to authenticated;

create or replace function public.friend_positions()
returns table (user_id uuid, lat double precision, lng double precision, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select w.user_id, w.lat, w.lng, w.updated_at
    from public.worker_locations w
   where w.user_id = auth.uid()
      or (w.share_stats and exists (
            select 1 from public.connections c
             where c.status = 'accepted'
               and ((c.requester_id = auth.uid() and c.addressee_id = w.user_id)
                 or (c.addressee_id = auth.uid() and c.requester_id = w.user_id))));
$$;

revoke all on function public.friend_positions() from public, anon;
grant execute on function public.friend_positions() to authenticated;

-- Saving your own position. A plain upsert of the table now fails, because
-- Postgres needs read access to the columns an upsert overwrites, and the
-- coordinates are no longer readable. This writes your own row, and only yours.
create or replace function public.save_my_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision default null,
  p_active_app text default null,
  p_today_distance_km double precision default 0,
  p_today_earnings double precision default 0,
  p_updated_at timestamptz default now(),
  p_timezone text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  insert into public.worker_locations
    (user_id, lat, lng, accuracy, active_app, today_distance_km, today_earnings, updated_at, timezone)
  values
    (auth.uid(), p_lat, p_lng, p_accuracy, p_active_app, p_today_distance_km, p_today_earnings, p_updated_at,
     coalesce(p_timezone, (select w.timezone from public.worker_locations w where w.user_id = auth.uid())))
  on conflict (user_id) do update set
    lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, active_app = excluded.active_app,
    today_distance_km = excluded.today_distance_km, today_earnings = excluded.today_earnings,
    updated_at = excluded.updated_at, timezone = coalesce(excluded.timezone, public.worker_locations.timezone);
end;
$$;

revoke all on function public.save_my_location(double precision, double precision, double precision, text, double precision, double precision, timestamptz, text) from public, anon;
grant execute on function public.save_my_location(double precision, double precision, double precision, text, double precision, double precision, timestamptz, text) to authenticated;


-- S8 — anyone could see who viewed someone else's story.
--
-- You see your own views, and the owner of a story sees who viewed it.

drop policy if exists "story views readable" on public.story_views;
drop policy if exists "story views own or owner" on public.story_views;
create policy "story views own or owner" on public.story_views
  for select to authenticated
  using (
    viewer_id = auth.uid()
    or exists (select 1 from public.stories s where s.id = story_views.story_id and s.user_id = auth.uid())
  );


-- S9a — a signed-out visitor could list open jobs with the public app key.

drop policy if exists "jobs readable" on public.jobs;
create policy "jobs readable" on public.jobs
  for select to authenticated
  using (assigned_to is null or assigned_to = auth.uid() or created_by = auth.uid());


-- D2 — new with dispatch: the worker holding a job could raise its payout or
-- move its pickup. The worker may change only the job's progress; the business
-- that posted it may edit it only while it is still open and unclaimed.

create or replace function public.guard_job_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if old.created_by = auth.uid() and old.status = 'open' and old.assigned_to is null
     and new.assigned_to is null and new.created_by is not distinct from old.created_by then
    return new;   -- the business editing its own open job
  end if;
  if (to_jsonb(new) - array['status', 'assigned_to', 'accepted_at', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'assigned_to', 'accepted_at', 'updated_at']) then
    raise exception 'A worker can change only the progress of a job' using errcode = '42501';
  end if;
  -- The only way a job changes hands is a worker claiming an unclaimed job for
  -- themselves, which accept_job() does. (Row-level security already stops a
  -- plain update from reaching an unclaimed job, so this is accept_job's path.)
  if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to
     and not (old.assigned_to is null and new.assigned_to = auth.uid()) then
    raise exception 'A job is claimed only by the worker taking it' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_job_update on public.jobs;
create trigger trg_guard_job_update
  before update on public.jobs
  for each row execute function public.guard_job_update();


-- S11 — the person receiving a friend request could rewrite who sent it and
-- mark it accepted, forging a friendship.
--
-- Who asked whom never changes. A pending request can be accepted or declined,
-- and that is all.

create or replace function public.guard_connection_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.requester_id is distinct from old.requester_id
     or new.addressee_id is distinct from old.addressee_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Who sent a request cannot change' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'pending' and new.status in ('accepted', 'declined')) then
    raise exception 'A request can only be accepted or declined, once' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_connection_update on public.connections;
create trigger trg_guard_connection_update
  before update on public.connections
  for each row execute function public.guard_connection_update();


-- S12 — a post's author could set its like counter to any number.
--
-- Likes are counted from post_likes. The counter column on the post, and who
-- wrote it and when, are not the author's to edit.

create or replace function public.guard_feed_post_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.likes is distinct from old.likes
     or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Likes, author and date of a post cannot be edited' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_feed_post_update on public.feed_posts;
create trigger trg_guard_feed_post_update
  before update on public.feed_posts
  for each row execute function public.guard_feed_post_update();


-- S13 — a blocked person could open a chat with the person who blocked them and
-- keep messaging.
--
-- A block, in either direction, stops a new direct chat and stops messages in
-- an existing one. Group chats are not affected: a block is between two people,
-- not between a person and a room.

create or replace function public.is_blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b)
        or (b.blocker_id = p_b and b.blocked_id = p_a)
  );
$$;

create or replace function public.blocked_in_thread(p_thread uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.chat_threads t
      join public.chat_thread_members m on m.thread_id = t.id and m.user_id <> p_user
     where t.id = p_thread
       and not t.is_group
       and public.is_blocked_pair(p_user, m.user_id)
  );
$$;

revoke all on function public.is_blocked_pair(uuid, uuid) from public, anon;
revoke all on function public.blocked_in_thread(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;
grant execute on function public.blocked_in_thread(uuid, uuid) to authenticated;

drop policy if exists "messages member insert" on public.chat_messages;
create policy "messages member insert" on public.chat_messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and public.is_thread_member(thread_id, auth.uid())
    and not public.blocked_in_thread(thread_id, auth.uid())
  );

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

  if public.is_blocked_pair(me, p_other) then
    raise exception 'This chat is not available' using errcode = '42501';
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

