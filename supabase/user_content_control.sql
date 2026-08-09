-- Buzz Buzz — let drivers DELETE their own content, plus one missing index.
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- Why this exists:
--   1. feed_posts had INSERT/SELECT/UPDATE but NO DELETE policy, so a driver
--      could never remove a post they regretted — the app's "⋯" only hid it
--      locally while everyone else still saw it forever.
--   2. chat_messages had the same gap: no way to delete a message you sent.
--   3. group_members is keyed (group_id, user_id). The app's "which groups am
--      I in?" query filters on user_id alone — the second PK column — which
--      Postgres cannot use that index for.

-- ---------------------------------------------------------------------------
-- 1. A driver may delete their own post. Likes/comments on it cascade away
--    via the existing foreign keys.
-- ---------------------------------------------------------------------------
drop policy if exists feed_posts_delete_own on public.feed_posts;
create policy feed_posts_delete_own on public.feed_posts
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. A driver may delete a message they sent. Deliberately restricted to their
--    OWN messages — being a thread member must not let you delete other
--    people's messages.
-- ---------------------------------------------------------------------------
drop policy if exists chat_messages_delete_own on public.chat_messages;
create policy chat_messages_delete_own on public.chat_messages
  for delete using (auth.uid() = sender_id);

-- ---------------------------------------------------------------------------
-- 3. Index the membership lookup by user.
-- ---------------------------------------------------------------------------
create index if not exists idx_group_members_user
  on public.group_members (user_id);

-- ---------------------------------------------------------------------------
-- 4. Sanity check — should list the two new delete policies and the index.
-- ---------------------------------------------------------------------------
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and policyname in ('feed_posts_delete_own', 'chat_messages_delete_own')
 order by tablename;

select indexname from pg_indexes
 where schemaname = 'public' and indexname = 'idx_group_members_user';

-- ============================================================================
-- Leaving a group conversation.
--
-- chat_thread_members had policies for reading and joining but none for
-- leaving, so a driver could be added to a group and never get out. The chat
-- header's overflow button had nothing it could offer because of it.
--
-- Self only: the predicate is the caller's own row, so this cannot be used to
-- remove somebody else from a conversation.
-- ============================================================================
drop policy if exists chat_members_leave_own on public.chat_thread_members;
create policy chat_members_leave_own
  on public.chat_thread_members for delete
  to authenticated
  using (user_id = auth.uid());
