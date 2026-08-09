-- Photos out of the database and into object storage.
--
-- Until now a photo was a base64 data URL sitting in a text column. A 1280px
-- JPEG is ~359 KB binary and ~479 KB once base64 inflates it by a third, and
-- loadPosts selects image_url for up to 100 rows — so opening the Community tab
-- could pull tens of megabytes through a driver's metered mobile data, and every
-- one of those bytes also sat in the database, in every backup, and in every
-- query plan that touched the table.
--
-- After this: the row holds two short URLs. The feed loads a ~20 KB thumbnail;
-- the full image is fetched only when someone taps it.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------- bucket
-- Public read: these are already-shared community photos, and public objects
-- are served straight from the CDN with no signing round trip. Nothing private
-- goes in this bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-photos', 'post-photos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ------------------------------------------------------------ storage RLS
-- Objects live at  {user_id}/{uuid}.jpg  so ownership is the first path segment.
-- A driver may only write inside their own folder, which is what stops one
-- account overwriting another's photos.

drop policy if exists "post photos are readable by anyone" on storage.objects;
create policy "post photos are readable by anyone"
  on storage.objects for select
  using (bucket_id = 'post-photos');

drop policy if exists "drivers upload into their own folder" on storage.objects;
create policy "drivers upload into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "drivers replace their own photos" on storage.objects;
create policy "drivers replace their own photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "drivers delete their own photos" on storage.objects;
create policy "drivers delete their own photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------- thumbnails
-- The feed reads *_thumb_url. The full-size column keeps its name so existing
-- rows keep working: anything already holding a data: URL still renders, it is
-- simply never written again.
alter table public.feed_posts    add column if not exists image_thumb_url text;
alter table public.chat_messages add column if not exists attachment_thumb_url text;

-- ------------------------------------------------------- optional clean-up
-- Existing base64 rows keep working and the app renders them as-is. If you want
-- the storage back, this shows what they are costing before you decide:
--
--   select count(*) as base64_posts,
--          pg_size_pretty(sum(length(image_url))::bigint) as bytes_in_table
--     from public.feed_posts
--    where image_url like 'data:%';
--
-- There is no automatic backfill here on purpose: re-uploading those bytes is a
-- one-off job that belongs on a machine you control, not in a migration that
-- might run against production twice.
