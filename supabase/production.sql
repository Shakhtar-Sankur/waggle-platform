-- Masaya Ako — production hardening (run AFTER schema.sql).
-- Adds performance indexes, updated_at triggers, and server-side chat push.
-- Safe to re-run (idempotent).

-- ---------------------------------------------------------------------------
-- 1. Performance indexes (keep queries fast as the user base grows)
-- ---------------------------------------------------------------------------
create index if not exists idx_jobs_status_created on public.jobs (status, created_at desc);
create index if not exists idx_jobs_assigned_to on public.jobs (assigned_to);
create index if not exists idx_feed_posts_created on public.feed_posts (created_at desc);
create index if not exists idx_chat_messages_thread_created on public.chat_messages (thread_id, created_at);
create index if not exists idx_chat_members_user on public.chat_thread_members (user_id);
create index if not exists idx_notifications_user_created on public.notifications (user_id, created_at desc);
create index if not exists idx_worker_locations_updated on public.worker_locations (updated_at desc);
create index if not exists idx_route_points_user_recorded on public.route_points (user_id, recorded_at desc);
create index if not exists idx_device_tokens_user on public.device_tokens (user_id);

-- ---------------------------------------------------------------------------
-- 2. Keep updated_at columns accurate automatically
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_driver_settings_touch on public.driver_settings;
create trigger trg_driver_settings_touch before update on public.driver_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_jobs_touch on public.jobs;
create trigger trg_jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Server-side push configuration
--    Fill this single row once (see supabase/PUSH_SETUP.md).
-- ---------------------------------------------------------------------------
create schema if not exists private;

create table if not exists private.push_config (
  id int primary key default 1 check (id = 1),
  function_url text not null,     -- https://<project-ref>.supabase.co/functions/v1/send-push
  webhook_secret text not null,   -- must match PUSH_WEBHOOK_SECRET function secret
  enabled boolean not null default true
);

-- This row holds a shared secret, so lock it down three ways rather than relying
-- on any one of them:
--
--   1. It lives in `private`, a schema PostgREST does not expose, so the API
--      cannot reach it at all.
--   2. No grants to anon or authenticated, so even if the schema were exposed
--      later the roles have nothing.
--   3. RLS on with no policies, which denies every non-owner by default.
--
-- None of this affects the push trigger below: it is SECURITY DEFINER and runs
-- as the table owner, and the edge function uses the service role. Both bypass
-- RLS. Supabase's SQL editor warns about a table created without RLS — this is
-- the answer to that warning, in the file, rather than a checkbox someone has to
-- remember to tick.
alter table private.push_config enable row level security;
revoke all on schema private from anon, authenticated;
revoke all on private.push_config from anon, authenticated;

-- pg_net lets Postgres make outbound HTTP calls (used to invoke the edge function).
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 4. Push a notification to every OTHER member when a chat message arrives
-- ---------------------------------------------------------------------------
create or replace function public.notify_new_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg private.push_config%rowtype;
  sender_name text;
  member record;
  preview text;
begin
  select * into cfg from private.push_config where id = 1;
  if not found or cfg.enabled is false then
    return new;
  end if;

  select coalesce(full_name, 'A driver') into sender_name
  from public.profiles where id = new.sender_id;

  preview := left(new.body, 120);

  for member in
    select user_id
    from public.chat_thread_members
    where thread_id = new.thread_id
      and user_id <> new.sender_id
  loop
    -- Fire-and-forget HTTP call; failures here must not block the insert.
    perform net.http_post(
      url := cfg.function_url,
      body := jsonb_build_object(
        'userId', member.user_id,
        'title', sender_name,
        'body', preview,
        'data', jsonb_build_object('threadId', new.thread_id::text, 'kind', 'chat')
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', cfg.webhook_secret
      )
    );
  end loop;

  return new;
exception
  when others then
    -- Never let a push failure roll back the message.
    raise warning 'notify_new_chat_message failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_chat_message_push on public.chat_messages;
create trigger trg_chat_message_push
  after insert on public.chat_messages
  for each row execute function public.notify_new_chat_message();

-- ---------------------------------------------------------------------------
-- chat_messages.id is a text primary key with no default, so every client has
-- to invent one. The app does; anything that forgets gets "null value in column
-- id violates not-null constraint" and cannot send a message at all. A default
-- makes the database stop depending on every caller remembering.
-- ---------------------------------------------------------------------------
alter table public.chat_messages
  alter column id set default gen_random_uuid()::text;
