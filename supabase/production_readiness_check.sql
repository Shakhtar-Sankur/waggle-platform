-- Does production actually have everything the app calls?
--
-- Every test in this project has run against the Supabase stack in Docker on
-- localhost. That proves the app's logic. It does NOT prove that the hosted
-- project has the same schema, because the backend was not built from one
-- script: 00_complete_backend.sql is the base, and five objects the code calls
-- live only in add-on files that each had to be run by hand. A file run against
-- the local stack and not the hosted one leaves no trace anywhere in the repo.
--
-- This is READ ONLY. It creates nothing and changes nothing. Paste it into the
-- SQL editor of the HOSTED project and read the result: every row that says
-- MISSING is a feature that will fail for real drivers while working perfectly
-- on localhost.
--
-- Run it against production. Running it against local will, of course, pass.

with required(kind, name, needed_by, sql_file) as (values
  -- Tables the client reads or writes by name.
  ('table','profiles',            'everything',                    '00_complete_backend.sql'),
  ('table','driver_settings',     'profile settings, earnings',    '00_complete_backend.sql'),
  ('table','route_points',        'tracking, 7-day record',        '00_complete_backend.sql'),
  ('table','worker_locations',    'live friends on the map',       '00_complete_backend.sql'),
  ('table','feed_posts',          'community feed',                '00_complete_backend.sql'),
  ('table','post_comments',       'comments',                      '00_complete_backend.sql'),
  ('table','post_likes',          'likes',                         '00_complete_backend.sql'),
  ('table','post_bookmarks',      'saved posts',                   'bookmarks.sql'),
  ('table','post_reposts',        'reposts',                       'reposts.sql'),
  ('table','stories',             'stories',                       'stories.sql'),
  ('table','story_views',         'seen/unseen story rings',       'stories.sql'),
  ('table','groups',              'community groups',              'groups.sql'),
  ('table','group_members',       'group membership',              'groups.sql'),
  ('table','connections',         'friend requests',               '00_complete_backend.sql'),
  ('table','user_blocks',         'block list',                    'report_and_block.sql'),
  ('table','content_reports',     'reporting',                     'report_and_block.sql'),
  ('table','chat_threads',        'messages',                      '00_complete_backend.sql'),
  ('table','chat_thread_members', 'messages',                      '00_complete_backend.sql'),
  ('table','chat_messages',       'messages',                      '00_complete_backend.sql'),
  ('table','message_reactions',   'reply reactions',               'chat_reply_reactions.sql'),
  ('table','chat_favourites',     'favourite chats filter',        'chat_favourites.sql'),
  ('table','notifications',       'notification list',             '00_complete_backend.sql'),
  ('table','notification_prefs',  'notification switches',         'notification_prefs.sql'),
  ('table','device_tokens',       'push delivery',                 '00_complete_backend.sql'),
  ('table','jobs',                'job cards',                     '00_complete_backend.sql'),
  -- Functions the client calls with .rpc(). A missing one is a silent failure:
  -- the call errors and the feature simply does nothing.
  ('function','route_daily_distance','7-day record, earnings report','route_daily_distance.sql'),
  ('function','start_direct_thread', 'opening a DM',                'direct_messages.sql'),
  ('function','create_thread',       'creating a thread',           'chat_thread_atomic.sql'),
  ('function','add_group_members',   'adding people to a group',    '2026-08-14_update.sql'),
  ('function','delete_own_account',  'Delete Account',              'delete_account_guard.sql')
)
select
  r.kind,
  r.name,
  case
    when r.kind = 'table' then
      case when exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = r.name
      ) then 'ok' else 'MISSING' end
    else
      case when exists (
        select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = r.name
      ) then 'ok' else 'MISSING' end
  end as status,
  r.needed_by,
  r.sql_file as run_this_file_if_missing
from required r
order by status desc, r.kind, r.name;

-- Second check: a table can exist with row-level security switched off, which
-- is worse than missing. It works in testing and exposes every driver's rows to
-- every other driver. Anything listed here is a live data leak.
select
  c.relname as table_without_rls,
  'enable RLS before launch' as action
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = false
  and c.relname in (
    'profiles','driver_settings','route_points','worker_locations','feed_posts',
    'post_comments','post_likes','post_bookmarks','post_reposts','stories',
    'story_views','groups','group_members','connections','user_blocks',
    'content_reports','chat_threads','chat_thread_members','chat_messages',
    'message_reactions','chat_favourites','notifications','notification_prefs',
    'device_tokens','jobs'
  )
order by 1;

-- Third check: realtime only delivers for tables added to its publication.
-- A table missing here still reads and writes correctly, so it passes every
-- functional test — it just never updates live, which is exactly the symptom
-- that looks like "the app feels slow" rather than "a table is misconfigured".
select
  t.name as table_not_in_realtime,
  'add to supabase_realtime publication' as action
from (values
  ('chat_messages'),('chat_threads'),('feed_posts'),('post_comments'),
  ('post_likes'),('connections'),('notifications'),('worker_locations')
) as t(name)
where not exists (
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime'
    and schemaname = 'public'
    and tablename = t.name
)
order by 1;
