-- People search — find any registered driver by name
--
-- The app searches with `full_name ILIKE '%term%'`. A leading wildcard cannot use
-- an ordinary B-tree index, so without help this is a sequential scan over every
-- profile on every keystroke. At a few hundred drivers nobody notices; at fifty
-- thousand it is the slowest query in the app, and it runs while someone types.
--
-- pg_trgm indexes the three-character sequences of a string, which is exactly
-- what a substring match needs, so ILIKE '%mar%' can use an index.
--
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent).

create extension if not exists pg_trgm;

-- Substring search: "mar" finds "Maricel" and "Ramarao".
create index if not exists idx_profiles_full_name_trgm
  on public.profiles using gin (full_name gin_trgm_ops);

-- Case-insensitive prefix search, which the planner can use for "starts with"
-- and for ordering results. Cheap to keep alongside the trigram index.
create index if not exists idx_profiles_full_name_lower
  on public.profiles (lower(full_name));

-- Reading profiles already requires a signed-in session — see
-- profiles_read_authenticated in 00_complete_backend.sql, which also revokes
-- anon. Search therefore exposes nothing that the community list did not
-- already, and an anonymous caller cannot enumerate drivers at all.
--
-- Note what a profile row deliberately does NOT carry: no email, no password,
-- no auth identifier. The phone→email scheme used at sign-in lives in
-- auth.users, which is not readable through the API.

-- Verify:
--   explain analyze
--   select id, full_name from public.profiles
--   where full_name ilike '%mar%' limit 40;
-- Expect a Bitmap Index Scan on idx_profiles_full_name_trgm once the table is
-- large enough for the planner to prefer it over a scan.
