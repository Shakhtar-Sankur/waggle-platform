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
