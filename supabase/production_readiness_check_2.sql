-- Checks two and three, split out and rewritten so they always return rows.
--
-- In the first file these were separate statements after the object check. The
-- SQL editor shows one result grid, so they were easy to run and never see.
-- Worse, both were written to return NOTHING when everything is correct, and an
-- empty grid reads identically to "I forgot to run it".
--
-- This is one query that always answers out loud. Read the `status` column:
-- every row says either ok or PROBLEM. Read only, changes nothing.
--
-- (The column is `check_name`, not `check`: CHECK is a reserved word in SQL and
-- Postgres rejects it as a bare identifier in the ORDER BY.)

-- CHECK 2: row-level security.
-- A table with RLS off is worse than a missing table. It reads and writes
-- perfectly, so every functional test passes, and meanwhile any signed-in
-- driver can read every other driver's rows — messages, locations, earnings.
-- This is the check that matters most before real people use the app.
with guarded(name) as (values
  ('profiles'),('driver_settings'),('route_points'),('worker_locations'),
  ('feed_posts'),('post_comments'),('post_likes'),('post_bookmarks'),
  ('post_reposts'),('stories'),('story_views'),('groups'),('group_members'),
  ('connections'),('user_blocks'),('content_reports'),('chat_threads'),
  ('chat_thread_members'),('chat_messages'),('message_reactions'),
  ('chat_favourites'),('notifications'),('notification_prefs'),
  ('device_tokens'),('jobs')
),
rls as (
  select
    '2. row-level security' as check_name,
    g.name                  as object,
    case
      when c.oid is null then 'PROBLEM - table not found'
      when c.relrowsecurity then 'ok'
      else 'PROBLEM - RLS IS OFF, every driver can read every row'
    end as status
  from guarded g
  left join pg_class c
    on c.relname = g.name
   and c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r'
),
-- A table can have RLS enabled and no policies at all, which denies everyone
-- and looks like "the feature is broken" rather than "it is misconfigured".
policies as (
  select
    '2b. has at least one policy' as check_name,
    g.name                        as object,
    case when exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = g.name
    ) then 'ok' else 'PROBLEM - RLS on but NO policies, so all access is denied' end as status
  from guarded g
),
-- CHECK 3: realtime.
-- A table missing from the publication still reads and writes correctly, so it
-- passes every functional test. It simply never updates live. The symptom is
-- "the app feels slow and I have to pull to refresh", which is why this is
-- worth checking explicitly rather than noticing it in use.
live(name, feature) as (values
  ('chat_messages','incoming messages'),
  ('chat_threads','chat list order'),
  ('feed_posts','new community posts'),
  ('post_comments','live comments'),
  ('post_likes','live like counts'),
  ('connections','friend requests'),
  ('notifications','the bell'),
  ('worker_locations','friends moving on the map')
),
realtime as (
  select
    '3. realtime publication' as check_name,
    l.name || ' (' || l.feature || ')' as object,
    case when exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = l.name
    ) then 'ok' else 'PROBLEM - not published, this will never update live' end as status
  from live l
)
-- The union goes in a FROM clause because Postgres will not accept an
-- expression in an ORDER BY applied directly to a UNION.
select check_name, object, status
from (
  select * from rls
  union all select * from policies
  union all select * from realtime
) all_checks
order by
  case when status like 'PROBLEM%' then 0 else 1 end,   -- problems first
  check_name, object;
