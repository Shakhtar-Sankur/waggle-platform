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
