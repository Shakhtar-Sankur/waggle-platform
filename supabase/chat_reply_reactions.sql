-- Reply-to and reactions for chat messages.
--
-- Two of the three things that make WhatsApp feel like WhatsApp and were
-- missing here. The third, typing, needs no schema — it is presence, not data.
--
-- Safe to run more than once, like every other migration in this folder.

-- ── replying to a message ────────────────────────────────────────────────
-- `on delete set null` rather than cascade: deleting a message must not delete
-- the replies to it. The quote disappears and the reply survives, which is what
-- a reader expects and what every chat app does.
alter table public.chat_messages
  add column if not exists reply_to text references public.chat_messages(id) on delete set null;

create index if not exists idx_chat_messages_reply_to
  on public.chat_messages (reply_to) where reply_to is not null;

-- ── reactions ────────────────────────────────────────────────────────────
-- A row per person per message, not a JSON blob on the message: two people
-- reacting at the same moment would otherwise overwrite each other, and a blob
-- cannot express "this person may remove only their own".
create table if not exists public.message_reactions (
  message_id text not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  -- One reaction per person per message. Tapping a different emoji replaces
  -- theirs rather than adding a second, which is how WhatsApp behaves.
  primary key (message_id, user_id)
);

create index if not exists idx_message_reactions_message
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- Readable by anyone who can see the thread the message belongs to. The
-- membership check is the same one the messages themselves use, so a reaction
-- can never be more visible than the message it is attached to.
drop policy if exists "reactions readable by thread members" on public.message_reactions;
create policy "reactions readable by thread members"
  on public.message_reactions for select
  using (
    exists (
      select 1
      from public.chat_messages m
      join public.chat_thread_members tm on tm.thread_id = m.thread_id
      where m.id = message_reactions.message_id
        and tm.user_id = auth.uid()
    )
  );

-- Writable only as yourself, and only into a thread you are in. Both halves
-- matter: without the membership check a driver could react to a stranger's
-- message by guessing an id, and without the uid check they could react as
-- somebody else.
drop policy if exists "reactions writable by the reactor" on public.message_reactions;
create policy "reactions writable by the reactor"
  on public.message_reactions for all
  using (
    auth.uid() = user_id
    and exists (
      select 1
      from public.chat_messages m
      join public.chat_thread_members tm on tm.thread_id = m.thread_id
      where m.id = message_reactions.message_id
        and tm.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.chat_messages m
      join public.chat_thread_members tm on tm.thread_id = m.thread_id
      where m.id = message_reactions.message_id
        and tm.user_id = auth.uid()
    )
  );
