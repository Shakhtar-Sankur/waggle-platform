-- Masaya Ako — enable LIVE updates + connection notifications. Run once. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Turn on Realtime broadcasting for the tables the app subscribes to.
--    Without this, the app only sees changes when it reloads.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'feed_posts', 'post_likes', 'post_comments', 'connections',
    'chat_messages', 'chat_threads', 'chat_thread_members',
    'worker_locations', 'notifications', 'jobs'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Notify a user when they get a connection request, and notify the
--    requester when it is accepted (Facebook-style).
-- ---------------------------------------------------------------------------
create or replace function public.notify_connection_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select coalesce(full_name, 'A driver') into who from public.profiles where id = new.requester_id;
    insert into public.notifications (id, user_id, title, description, kind, read, created_at)
    values (gen_random_uuid()::text, new.addressee_id, 'New connection request',
            who || ' wants to connect with you.', 'system', false, now());
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and coalesce(old.status, '') <> 'accepted' then
    select coalesce(full_name, 'A driver') into who from public.profiles where id = new.addressee_id;
    insert into public.notifications (id, user_id, title, description, kind, read, created_at)
    values (gen_random_uuid()::text, new.requester_id, 'Connection accepted',
            who || ' accepted your connection request.', 'system', false, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_connection_notify on public.connections;
create trigger trg_connection_notify
  after insert or update on public.connections
  for each row execute function public.notify_connection_change();
