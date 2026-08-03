-- Buzz Buzz — CLOSE PUBLIC READ ACCESS TO DRIVER DATA.  ** RUN THIS BEFORE LAUNCH **
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).
--
-- ============================================================================
-- WHAT WAS WRONG
-- ============================================================================
-- Five tables were created with `for select using (true)`. In Postgres RLS,
-- `true` means EVERYONE — including the anonymous role. The app's publishable
-- key ships inside the Android APK and can be extracted from the .apk file in
-- about a minute, so "anonymous" in practice means "anybody who installs the
-- app or downloads it from the Play Store".
--
-- Verified live against the production project with only the publishable key
-- and no login:
--   • public.profiles          → id, full_name, PHONE, avatar_url, last_seen
--   • public.worker_locations  → user_id, LAT, LNG, accuracy, active_app,
--                                today_distance_km, today_earnings, rating
--   • public.feed_posts        → every community post
--   • public.post_likes / post_comments → all social activity
--
-- i.e. anyone could continuously harvest every driver's PHONE NUMBER and LIVE
-- GPS POSITION. For gig workers that is a stalking and harassment risk, and it
-- is very likely a breach of India's DPDP Act, the Philippines Data Privacy
-- Act, and GDPR where applicable.
--
-- ============================================================================
-- 1. Stop exposing phone numbers through the API at all.
--    PostgREST honours column-level GRANTs. The client never SELECTs
--    profiles.phone (it is written on signup and read from the auth session),
--    so removing it breaks nothing.
-- ============================================================================
revoke select (phone) on public.profiles from anon;
revoke select (phone) on public.profiles from authenticated;

-- ============================================================================
-- 2. Require a logged-in session to read community data.
-- ============================================================================
drop policy if exists "profiles readable" on public.profiles;
create policy profiles_read_authenticated on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "posts readable" on public.feed_posts;
create policy feed_posts_read_authenticated on public.feed_posts
  for select using (auth.role() = 'authenticated');

drop policy if exists "likes readable" on public.post_likes;
create policy post_likes_read_authenticated on public.post_likes
  for select using (auth.role() = 'authenticated');

drop policy if exists "comments readable" on public.post_comments;
create policy post_comments_read_authenticated on public.post_comments
  for select using (auth.role() = 'authenticated');

-- ============================================================================
-- 3. Location: make the "Share stats with community" switch REAL.
--    Until now that toggle was stored and displayed but never enforced
--    anywhere — a driver could switch it off and their GPS kept uploading and
--    kept being served. Now the database itself honours it.
--    A driver can always see their own row.
-- ============================================================================
alter table public.worker_locations
  add column if not exists share_stats boolean not null default true;

drop policy if exists "locations readable" on public.worker_locations;
create policy worker_locations_read_authenticated on public.worker_locations
  for select using (
    auth.role() = 'authenticated'
    and (share_stats or user_id = auth.uid())
  );

-- ============================================================================
-- 4. Verify. After running, `anon_can_read` must be FALSE for every row.
-- ============================================================================
select tablename,
       policyname,
       cmd,
       qual as using_expression,
       (qual = 'true') as anon_can_read
  from pg_policies
 where schemaname = 'public'
   and cmd = 'SELECT'
   and tablename in ('profiles','worker_locations','feed_posts','post_likes','post_comments')
 order by tablename;

-- Should return NO row for 'phone' (anon/authenticated can no longer select it).
select grantee, privilege_type, column_name
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name = 'profiles'
   and column_name = 'phone'
   and grantee in ('anon','authenticated');
