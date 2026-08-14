-- ============================================================================
-- Buzz Buzz — changes of 2026-08-14
-- ============================================================================
--
-- Run this once in the SQL editor of any project that already has the backend:
--   production  ypdaetbeexyepswyhbui
--   test        jqepegeifmnfofeyebrz
--
-- Everything here is also inside 00_complete_backend.sql, which is idempotent
-- and safe to re-run in full. This exists so you don't have to push 1,600 lines
-- at a live project to add four things.
--
-- Safe to run more than once. Nothing drops a table or deletes a row.
--
-- WHAT IT ADDS
--   1. Groups: the ability to add other drivers at all, capped at 20.
--   2. Reels: video storage and a column to point at it.
--   3. Notifications when a connected driver posts or shares a reel.
--
-- After running, the app needs no migration of its own — existing posts keep
-- working, and video_url is simply null on all of them.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- 1. GROUP MEMBERSHIP
-- ─────────────────────────────────────────────────────────────────────────
-- RLS on chat_thread_members allows `auth.uid() = user_id` only, so a driver
-- may insert themselves and nobody else. That is the right default and it is
-- also why every group was a room its creator sat in alone. This function
-- grants exactly the missing privilege and enforces what the policy cannot:
-- the caller must be in the thread, everyone added must be an ACCEPTED
-- connection, and a group tops out at 20.
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

      -- Counted inside the loop, so adding five to a group of eighteen stops at
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


-- ─────────────────────────────────────────────────────────────────────────
-- 2. REELS: VIDEO
-- ─────────────────────────────────────────────────────────────────────────
-- The bucket accepted images only, so a reel could never be more than a photo.
-- 30 MB is enough for a 60-second phone clip and no more: the app does not
-- transcode, so whatever the camera recorded is what uploads, and these drivers
-- pay for data by the megabyte.
update storage.buckets
   set allowed_mime_types = array[
         'image/jpeg','image/png','image/webp',
         'video/mp4','video/quicktime','video/webm'
       ],
       file_size_limit = 31457280          -- 30 MB
 where id = 'post-photos';

alter table public.feed_posts
  add column if not exists video_url text;

comment on column public.feed_posts.video_url is
  'Storage URL of a reel video. A post carries an image or a video, not both.';


-- ─────────────────────────────────────────────────────────────────────────
-- 3. POST AND REEL NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────────
-- Likes, comments, messages and friend requests all raised notifications;
-- posting did not, so nobody learned a friend had shared anything.
--
-- Connected drivers only. Notifying everyone becomes unusable the moment the
-- app has real users, and it would leak who is active to people you never
-- accepted.
create or replace function public.notify_new_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author_name text;
  friend_id uuid;
  is_reel boolean := new.video_url is not null;
begin
  select full_name into author_name from public.profiles where id = new.user_id;

  for friend_id in
    select case when c.requester_id = new.user_id then c.addressee_id else c.requester_id end
      from public.connections c
     where c.status = 'accepted'
       and (c.requester_id = new.user_id or c.addressee_id = new.user_id)
  loop
    -- notifications.id is NOT NULL, text, and has no default — every other
    -- notification trigger supplies it the same way. Omitting it fails the
    -- insert, which fails the trigger, which blocks the post itself.
    insert into public.notifications (id, user_id, title, description, kind, read, created_at)
    values (
      gen_random_uuid()::text,
      friend_id,
      case when is_reel then 'New reel 🎬' else 'New post 📣' end,
      coalesce(author_name, 'A driver') ||
        case when is_reel then ' shared a reel.' else ': ' || left(coalesce(new.body, ''), 60) end,
      'system', false, now()
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_new_post on public.feed_posts;
create trigger trg_notify_new_post
  after insert on public.feed_posts
  for each row execute function public.notify_new_post();


-- You can always see your own membership row.
--
-- The policy was is_thread_member(thread_id, auth.uid()) alone, which asks "are
-- you already in this thread" by querying the very table being read. Two
-- consequences:
--
--   1. Inserting yourself and asking for the row back (any client that sends
--      Prefer: return=representation, which supabase-js does whenever .select()
--      is chained) fails with "new row violates row-level security policy" —
--      a misleading message, since the INSERT passed and it was the RETURNING
--      that was refused.
--   2. It is simply wrong. A driver should be able to read the row that says
--      they are a member, without that read depending on itself.
--
-- Adding `user_id = auth.uid()` fixes both. It grants nothing new: you could
-- already insert exactly this row, so being able to read it back reveals
-- nothing you did not just write.
drop policy if exists "members readable by members" on public.chat_thread_members;
create policy "members readable by members"
  on public.chat_thread_members for select
  using (
    user_id = auth.uid()
    or public.is_thread_member(thread_id, auth.uid())
  );


-- ─────────────────────────────────────────────────────────────────────────
-- 4. VERIFY
-- ─────────────────────────────────────────────────────────────────────────
-- Raises rather than printing, so this file cannot report success while one of
-- the three changes silently failed to apply.
do $$
declare
  missing text := '';
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'add_group_members') then
    missing := missing || 'add_group_members ';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'feed_posts'
                    and column_name = 'video_url') then
    missing := missing || 'feed_posts.video_url ';
  end if;

  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_notify_new_post' and not tgisinternal) then
    missing := missing || 'trg_notify_new_post ';
  end if;

  if not exists (select 1 from storage.buckets, unnest(allowed_mime_types) m
                  where id = 'post-photos' and m = 'video/mp4') then
    missing := missing || 'video-in-bucket ';
  end if;

  if missing <> '' then
    raise exception 'UPDATE INCOMPLETE — still missing: %', missing;
  end if;

  raise notice 'Update applied: group membership (max 20), reel video, post/reel notifications.';
end $$;
