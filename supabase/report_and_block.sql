-- Reporting and blocking.
--
-- Google Play's User Generated Content policy requires that an app carrying
-- user content give people an in-app way to report objectionable content AND to
-- block other users. Waggle has a public feed, group chat, direct messages,
-- photos and voice notes, and had neither. What existed was "hide post", which
-- only hid it locally — everyone else still saw it — and deleting your OWN
-- content, which is not moderation at all.
--
-- Two tables, because they answer different questions. A report is a message to
-- the operator about a thing; a block is a standing instruction about a person,
-- and it takes effect for the blocker immediately without anyone reviewing it.

-- ── reports ────────────────────────────────────────────────────────────────
create table if not exists public.content_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  -- What is being reported. Deliberately not a foreign key: a post can be
  -- deleted after it is reported, and the report has to survive that — it is
  -- the record of the complaint, not a pointer to live content.
  target_type  text not null check (target_type in ('post', 'message', 'user')),
  target_id    text not null,
  -- Who posted it, kept so repeated reports about one person can be counted
  -- without joining back to content that may be gone.
  target_user  uuid references public.profiles(id) on delete set null,
  reason       text not null check (reason in
                 ('spam', 'harassment', 'hate', 'violence', 'sexual', 'other')),
  note         text check (note is null or char_length(note) <= 1000),
  -- A snapshot of the reported text. Without it, a report about a message the
  -- sender then deletes arrives with nothing to look at.
  excerpt      text check (excerpt is null or char_length(excerpt) <= 500),
  status       text not null default 'open' check (status in ('open', 'reviewed', 'actioned')),
  created_at   timestamptz not null default now(),
  -- One report per person per thing. Re-reporting the same post is not more
  -- signal, and without this a rage-tap sends twenty rows.
  unique (reporter_id, target_type, target_id)
);

create index if not exists idx_content_reports_open
  on public.content_reports (created_at desc) where status = 'open';
create index if not exists idx_content_reports_target_user
  on public.content_reports (target_user) where target_user is not null;

alter table public.content_reports enable row level security;

-- A reporter may file, and may see what they filed. Nobody reads anyone else's
-- reports through this API: triage happens in the dashboard, under the service
-- role, so a curious user cannot enumerate who reported whom.
drop policy if exists content_reports_insert_own on public.content_reports;
create policy content_reports_insert_own on public.content_reports
  for insert with check (auth.uid() = reporter_id);

drop policy if exists content_reports_read_own on public.content_reports;
create policy content_reports_read_own on public.content_reports
  for select using (auth.uid() = reporter_id);

-- ── blocks ─────────────────────────────────────────────────────────────────
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  -- Blocking yourself is not a thing, and it would hide your own posts.
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists idx_user_blocks_blocker on public.user_blocks (blocker_id);

alter table public.user_blocks enable row level security;

-- You manage your own block list, and you can read only your own. Deliberately
-- NOT readable by the blocked party: telling someone they have been blocked is
-- how a block turns into an escalation.
drop policy if exists user_blocks_manage_own on public.user_blocks;
create policy user_blocks_manage_own on public.user_blocks
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

comment on table public.content_reports is
  'User reports of objectionable posts, messages or people. Required by Play''s UGC policy. Triage under the service role.';
comment on table public.user_blocks is
  'Per-user block list. Blocked people''s posts, comments and messages are filtered client-side and their content is not shown to the blocker.';
