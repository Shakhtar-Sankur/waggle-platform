-- WhatsApp-style presence / "last seen"
-- Adds a heartbeat timestamp to profiles. The app updates it every ~45s while the
-- app is open (foreground). Other users read it to show "online" vs "last seen X".
--
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

alter table public.profiles
  add column if not exists last_seen timestamptz;

-- Let each user update their OWN last_seen. profiles already lets a user update
-- their own row for name/phone; this makes sure the heartbeat is allowed even if
-- your update policy is column-scoped.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_update_own_presence'
  ) then
    drop policy if exists profiles_update_own_presence on public.profiles;
    create policy profiles_update_own_presence
      on public.profiles
      for update
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;

-- Optional: index so "who is online" style lookups stay fast at scale.
create index if not exists profiles_last_seen_idx on public.profiles (last_seen);
