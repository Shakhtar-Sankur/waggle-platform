-- Real community groups: stored in the cloud with REAL member counts.
-- Joining/leaving writes a membership row; every client sees the true count.
--
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

create table if not exists public.groups (
  id text primary key,
  name text not null,
  description text not null default '',
  color text not null default '#ff4d17',
  icon text not null default '🚗',
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id text not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select using (auth.role() = 'authenticated');

drop policy if exists group_members_read on public.group_members;
create policy group_members_read on public.group_members
  for select using (auth.role() = 'authenticated');

drop policy if exists group_members_join on public.group_members;
create policy group_members_join on public.group_members
  for insert with check (auth.uid() = user_id);

drop policy if exists group_members_leave on public.group_members;
create policy group_members_leave on public.group_members
  for delete using (auth.uid() = user_id);

-- Starter groups (member counts are REAL — they start at zero).
insert into public.groups (id, name, description, color, icon) values
  ('group_grab_mnl',  'Grab Drivers Manila',            'Tips, surge alerts, and support for Metro Manila Grab drivers.', '#00b14f', '🚗'),
  ('group_angkas',    'Angkas Riders PH',               'Route hacks and rider community for Angkas motorcycle drivers.', '#0d3b66', '🏍️'),
  ('group_foodpanda', 'Foodpanda Riders Community',     'Peak-hour zones, batching tips, and rider meetups.',             '#d70f64', '🛵'),
  ('group_traffic',   'Metro Manila Traffic Updates',   'Live road, flood, and checkpoint updates from fellow drivers.',  '#f59e0b', '🚦'),
  ('group_tips',      'Gig Worker Tips & Tricks',       'Earn more, spend less — advice from experienced gig drivers.',   '#7c3aed', '💡')
on conflict (id) do nothing;
