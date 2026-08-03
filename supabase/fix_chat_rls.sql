-- Masaya Ako — CHAT RLS FIX (run once on an existing database). Safe to re-run.
-- Fixes three chat security-policy problems:
--   1. Infinite recursion on chat_thread_members (broke reading threads/messages).
--   2. Thread creator could not see the thread they just created (create failed).
--   3. No policy let a member bump a thread's updated_at when sending a message.

-- Helper: membership check with definer rights so policies never recurse.
create or replace function public.is_thread_member(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.chat_thread_members
    where thread_id = p_thread_id and user_id = p_user_id
  );
$$;

-- chat_threads: members OR the creator can read (creator needs it right after insert).
drop policy if exists "threads member read" on public.chat_threads;
create policy "threads member read" on public.chat_threads for select using (
  public.is_thread_member(id, auth.uid()) or created_by = auth.uid()
);

-- chat_threads: members can update (used to bump updated_at when a message is sent).
drop policy if exists "threads member update" on public.chat_threads;
create policy "threads member update" on public.chat_threads for update
  using (public.is_thread_member(id, auth.uid()) or created_by = auth.uid())
  with check (public.is_thread_member(id, auth.uid()) or created_by = auth.uid());

-- chat_thread_members: non-recursive read.
drop policy if exists "members readable by members" on public.chat_thread_members;
create policy "members readable by members" on public.chat_thread_members for select using (
  public.is_thread_member(thread_id, auth.uid())
);

-- chat_messages: read/insert restricted to thread members, no recursion.
drop policy if exists "messages member read" on public.chat_messages;
create policy "messages member read" on public.chat_messages for select using (
  public.is_thread_member(chat_messages.thread_id, auth.uid())
);

drop policy if exists "messages member insert" on public.chat_messages;
create policy "messages member insert" on public.chat_messages for insert with check (
  auth.uid() = sender_id and
  public.is_thread_member(chat_messages.thread_id, auth.uid())
);
