-- Favourite chats, so they follow the driver rather than the handset.
--
-- They started in local storage, which works and survives a reload but not a
-- new phone — and a driver who replaces a cracked handset should not have to
-- rebuild the short list of people they talk to most. Post bookmarks already
-- live on the server; this is the same idea about a thread.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists public.chat_favourites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

alter table public.chat_favourites enable row level security;

-- Nobody else's business. A favourite says who you talk to most, which is the
-- kind of thing that should not be readable across accounts even inside one
-- co-operative: the whole table is scoped to the caller, in every direction.
drop policy if exists chat_favourites_read on public.chat_favourites;
create policy chat_favourites_read on public.chat_favourites
  for select using (auth.uid() = user_id);

drop policy if exists chat_favourites_add on public.chat_favourites;
create policy chat_favourites_add on public.chat_favourites
  for insert with check (auth.uid() = user_id);

drop policy if exists chat_favourites_remove on public.chat_favourites;
create policy chat_favourites_remove on public.chat_favourites
  for delete using (auth.uid() = user_id);

-- The lookup the app makes on every chat-list render is "which of mine",
-- so the index leads with the user.
create index if not exists idx_chat_favourites_user
  on public.chat_favourites (user_id, created_at desc);
