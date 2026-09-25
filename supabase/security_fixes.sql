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


-- D3 — new with dispatch: the worker holding a job could raise its payout or
-- move its pickup. A worker's changes now happen only inside the job-step
-- functions (business.sql); the business may only cancel a job nobody has taken.
-- This function is identical in business.sql; keep them the same.

create or replace function public.guard_job_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or current_setting('waggle.job_step', true) = 'on' then
    return new;
  end if;
  if old.created_by = auth.uid() and old.assigned_to is null then
    if (to_jsonb(new) - array['status', 'note', 'updated_at'])
       is distinct from (to_jsonb(old) - array['status', 'note', 'updated_at'])
       or (new.status is distinct from old.status and not (old.status = 'open' and new.status = 'cancelled')) then
      raise exception 'A business can cancel an open job or edit its note, nothing else' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'Jobs move forward only through the app''s job steps' using errcode = '42501';
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
