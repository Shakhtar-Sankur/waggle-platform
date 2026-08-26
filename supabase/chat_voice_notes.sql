-- Voice notes on chat messages.
--
-- Separate columns rather than reusing attachment_url: a client that finds a
-- URL there today renders an <img>, and an audio file in an image tag is a
-- broken-picture icon, not a playable note. Old clients should see a message
-- with no attachment, which is wrong but harmless, rather than a broken one.

alter table public.chat_messages
  add column if not exists voice_url text,
  add column if not exists voice_seconds numeric,
  -- The waveform is drawn from levels captured while recording. Storing them
  -- means the bubble draws instantly instead of downloading and decoding the
  -- audio to find its shape — on a driver's connection that is the difference
  -- between a chat that renders and one that hangs.
  add column if not exists voice_levels jsonb;

-- A note longer than the recorder's own ceiling means the client was bypassed.
alter table public.chat_messages
  drop constraint if exists chat_messages_voice_len;
alter table public.chat_messages
  add constraint chat_messages_voice_len
  check (voice_seconds is null or (voice_seconds > 0 and voice_seconds <= 180));

-- Audio lives in its own bucket, so a storage policy for pictures can never
-- accidentally decide who may hear a private conversation.
insert into storage.buckets (id, name, public)
values ('chat-voice', 'chat-voice', true)
on conflict (id) do nothing;

-- Anyone may read (the URL is unguessable and the bucket is public, matching
-- how photos already work), but you may only write into your own folder.
drop policy if exists "voice upload own" on storage.objects;
create policy "voice upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "voice read" on storage.objects;
create policy "voice read" on storage.objects
  for select using (bucket_id = 'chat-voice');

drop policy if exists "voice delete own" on storage.objects;
create policy "voice delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
