-- ============================================================================
-- Buzz Buzz — FULL RESET.  DELETES EVERY ACCOUNT AND ALL USER DATA.
-- ============================================================================
--
--   ⚠️  THIS CANNOT BE UNDONE. THERE IS NO RECYCLE BIN.
--
-- This removes every registered driver — including YOUR OWN account and the
-- accounts of anyone who has already signed up (Sipra, Snehasis, Shibnath,
-- Suparna, Sudarsan …). They will all have to sign up again from scratch.
--
-- Run it in the Supabase SQL editor, in TWO passes:
--   PASS 1 — run only STEP 1 and read the counts. That is what you are about
--            to destroy. Stop here if anything looks wrong.
--   PASS 2 — if you are certain, run STEP 2 and STEP 3.
--
-- What is KEPT: the schema, all RLS policies, and the five app-defined groups
-- (they are app content, not user data). Their member counts return to 0
-- naturally because memberships are deleted.
-- ============================================================================


-- ============================================================================
-- STEP 1 — PREVIEW. Run this ALONE first. Nothing is deleted.
-- ============================================================================
select 'auth users'        as what, count(*) from auth.users
union all select 'profiles',         count(*) from public.profiles
union all select 'feed posts',       count(*) from public.feed_posts
union all select 'post likes',       count(*) from public.post_likes
union all select 'post comments',    count(*) from public.post_comments
union all select 'chat threads',     count(*) from public.chat_threads
union all select 'chat messages',    count(*) from public.chat_messages
union all select 'connections',      count(*) from public.connections
union all select 'worker locations', count(*) from public.worker_locations
union all select 'route points',     count(*) from public.route_points
union all select 'driver settings',  count(*) from public.driver_settings
union all select 'notifications',    count(*) from public.notifications
union all select 'group members',    count(*) from public.group_members
union all select 'device tokens',    count(*) from public.device_tokens
order by 1;

-- See exactly whose accounts will be destroyed:
select id, email, created_at, last_sign_in_at
  from auth.users
 order by created_at;


-- ============================================================================
-- STEP 2 — THE RESET. Only run this once STEP 1 looks right.
-- ============================================================================
-- Deleting an auth user cascades to profiles, and profiles cascades to
-- driver_settings, worker_locations, route_points, feed_posts, post_likes,
-- post_comments, connections, chat_thread_members, chat_messages,
-- notifications, group_members and device_tokens.
--
-- (Verified from the schema: profiles.id references auth.users(id) ON DELETE
--  CASCADE, and every user-owned table references profiles(id) ON DELETE
--  CASCADE.)

delete from auth.users;

-- chat_threads.created_by is ON DELETE SET NULL, NOT cascade — so the threads
-- themselves survive as empty shells once their members and messages are gone.
-- Clear them explicitly.
delete from public.chat_threads;

-- The old sample jobs, if this database still holds them. The jobs feature is
-- not in the app and the seed was removed from schema.sql.
delete from public.jobs;


-- ============================================================================
-- STEP 3 — VERIFY. Every row must read 0 except "groups", which stays at 5.
-- ============================================================================
select 'auth users'        as what, count(*) from auth.users
union all select 'profiles',         count(*) from public.profiles
union all select 'feed posts',       count(*) from public.feed_posts
union all select 'post likes',       count(*) from public.post_likes
union all select 'post comments',    count(*) from public.post_comments
union all select 'chat threads',     count(*) from public.chat_threads
union all select 'chat messages',    count(*) from public.chat_messages
union all select 'connections',      count(*) from public.connections
union all select 'worker locations', count(*) from public.worker_locations
union all select 'route points',     count(*) from public.route_points
union all select 'driver settings',  count(*) from public.driver_settings
union all select 'notifications',    count(*) from public.notifications
union all select 'group members',    count(*) from public.group_members
union all select 'device tokens',    count(*) from public.device_tokens
union all select 'jobs',             count(*) from public.jobs
union all select 'groups (KEPT: 5)', count(*) from public.groups
order by 1;
