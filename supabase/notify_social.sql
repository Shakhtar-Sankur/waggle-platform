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
