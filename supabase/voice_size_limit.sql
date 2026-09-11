-- Cap the voice-note bucket, which currently accepts a file of any size.
--
-- The app already limits a recording to 120 seconds and 2 MB, in
-- VoiceService.ts. That limit lives in the client, which means it holds for
-- anyone using the app and for nobody else: the anon key ships inside the
-- bundle, so a signed-in account can POST straight to the storage endpoint and
-- put a file of any size into a public bucket that Gigzen pays to serve. The
-- photo bucket was capped at 30 MB and this one was left open, which reads as
-- an oversight rather than a decision.
--
-- 5 MB, not 2 MB. The client cap is on the recorded blob; the stored object
-- carries container overhead on top, and Android (webm/opus) and iOS (mp4/aac)
-- do not produce the same size for the same 120 seconds. A cap set exactly at
-- the client's limit would reject legitimate notes on one platform and not the
-- other — the worst kind of bug, because it only appears on hardware nobody
-- tested on. 5 MB never rejects a real note and still makes the bucket useless
-- as free file hosting.
--
-- Existing objects are unaffected; this applies to new uploads.

update storage.buckets
   set file_size_limit = 5 * 1024 * 1024
 where id = 'chat-voice';

-- Confirm. Expect chat-voice 5 MB and post-photos 30 MB.
select
  id as bucket,
  public,
  case
    when file_size_limit is null then 'UNCAPPED'
    else (file_size_limit / 1048576)::text || ' MB'
  end as size_limit
from storage.buckets
where id in ('chat-voice', 'post-photos')
order by id;
