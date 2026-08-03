-- Masaya Ako — allow photos on community posts. Run once. Safe to re-run.
alter table public.feed_posts add column if not exists image_url text;
