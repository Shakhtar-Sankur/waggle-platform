-- Check four: object storage.
--
-- The first two files checked tables, functions, policies and realtime, and the
-- hosted project passed all of them. Neither covered storage, which was a hole
-- in my own checklist rather than in the app: photos, profile pictures and
-- voice notes do not live in Postgres. They live in buckets, and a bucket that
-- is missing or unreadable fails exactly like a missing table — except nothing
-- in the first two checks would have said a word about it.
--
-- The app needs two, named in SupabaseService.ts:
--   post-photos  PHOTO_BUCKET  feed images, story images, profile avatars
--   chat-voice   VOICE_BUCKET  voice notes in direct messages
--
-- Read only. Every row says ok or PROBLEM, problems first.

with wanted(bucket, used_for) as (values
  ('post-photos','feed photos, stories, profile avatars'),
  ('chat-voice','voice notes in chat')
),
buckets as (
  select
    '4. bucket exists' as check_name,
    w.bucket || ' (' || w.used_for || ')' as object,
    case when b.id is null
      then 'PROBLEM - bucket missing, every upload will fail'
      else 'ok' end as status
  from wanted w
  left join storage.buckets b on b.id = w.bucket
),
-- An upload policy per bucket. Without an INSERT policy the driver taps send,
-- nothing happens, and the only clue is a 403 in a console they cannot see.
uploads as (
  select
    '4b. upload allowed' as check_name,
    w.bucket as object,
    case when exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'
    ) then 'ok' else 'PROBLEM - no INSERT policy on storage.objects, uploads will 403' end as status
  from wanted w
),
-- And a read policy, or the upload succeeds and the image never renders.
reads as (
  select
    '4c. read allowed' as check_name,
    w.bucket as object,
    case when exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'
    ) then 'ok' else 'PROBLEM - no SELECT policy, uploaded media will not display' end as status
  from wanted w
),
-- A size cap. Not a crash, a bill: without one, a single 400MB video upload is
-- accepted and served. post-photos is capped locally at 30MB; chat-voice is not
-- capped at all, which is worth deciding on deliberately rather than by default.
limits as (
  select
    '4d. size limit set' as check_name,
    w.bucket as object,
    case
      when b.id is null then 'PROBLEM - bucket missing'
      when b.file_size_limit is null
        then 'review - no size limit, any file size is accepted'
      else 'ok (' || (b.file_size_limit / 1048576) || ' MB)'
    end as status
  from wanted w
  left join storage.buckets b on b.id = w.bucket
)
select check_name, object, status
from (
  select * from buckets
  union all select * from uploads
  union all select * from reads
  union all select * from limits
) all_checks
order by
  case
    when status like 'PROBLEM%' then 0
    when status like 'review%' then 1
    else 2
  end,
  check_name, object;
