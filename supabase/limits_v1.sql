-- ============================================================================
-- Waggle limits v1: caps on how fast one person can create things.
--
-- Run AFTER every earlier file (it guards their tables). Safe to run again.
--
-- A guard on the table itself, not in each function, so no path around it:
-- the apps, the delivery API and a script hitting the database directly all
-- meet the same limit. Over the limit the database answers HTTP 429 with
-- "Too many requests", and nothing is written.
--
-- Only people are limited. The database's own work (scheduled Sends going out,
-- month-end billing, anything run with the service key) is not.
--
-- Guest orders are counted by the phone number on the order, not by network
-- address: in India most phones share an address with thousands of others.
-- ============================================================================


create table if not exists public.rate_hits (
  action text not null,
  key    text not null,
  at     timestamptz not null default now()
);
create index if not exists idx_rate_hits on public.rate_hits (action, key, at desc);
alter table public.rate_hits enable row level security;
revoke all on table public.rate_hits from anon, authenticated;

create or replace function public._rate_check(p_action text, p_key text, p_max integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null then
    return;
  end if;
  if (select count(*) from public.rate_hits where action = p_action and key = p_key and at > now() - p_window) >= p_max then
    raise exception 'Too many requests. Please wait a little and try again.' using errcode = 'PT429';
  end if;
  insert into public.rate_hits (action, key) values (p_action, p_key);
end;
$$;

-- TG_ARGV: action, key column(s) tried in order ("customer_id|customer_phone"), max, window.
create or replace function public._rate_limit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_col text;
  v_key text;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'anon' then
    return new;
  end if;
  foreach v_col in array string_to_array(TG_ARGV[1], '|') loop
    v_key := v_row ->> v_col;
    exit when v_key is not null;
  end loop;
  if v_key is not null then
    perform public._rate_check(TG_ARGV[0], v_col || ':' || v_key, TG_ARGV[2]::integer, TG_ARGV[3]::interval);
  end if;
  return new;
end;
$$;

revoke all on function public._rate_check(text, text, integer, interval) from public, anon, authenticated;
revoke all on function public._rate_limit_row() from public, anon, authenticated;

do $$
declare
  l record;
begin
  for l in
    select * from (values
      ('orders',          'order',   'customer_id|customer_phone', 10,  '1 hour'),
      ('sends',           'send',    'customer_id',                10,  '1 hour'),
      ('jobs',            'job',     'business_id|created_by',     300, '1 hour'),
      ('support_tickets', 'ticket',  'user_id',                    10,  '1 day'),
      ('feed_posts',      'post',    'user_id',                    20,  '1 hour'),
      ('post_comments',   'comment', 'user_id',                    60,  '1 hour'),
      ('chat_messages',   'message', 'sender_id',                  60,  '1 minute'),
      ('content_reports', 'report',  'reporter_id',                20,  '1 day'),
      ('stories',         'story',   'user_id',                    30,  '1 day'),
      ('connections',     'connect', 'requester_id',               50,  '1 day')
    ) as t(tbl, action, cols, max_n, win)
  loop
    execute format('drop trigger if exists trg_rate_limit on public.%I', l.tbl);
    execute format('create trigger trg_rate_limit before insert on public.%I for each row execute function public._rate_limit_row(%L, %L, %L, %L)',
                   l.tbl, l.action, l.cols, l.max_n::text, l.win);
  end loop;
end;
$$;

-- Hits older than two days are no use to any limit.
create extension if not exists pg_cron;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'waggle-rate-hits-cleanup') then
    perform cron.unschedule('waggle-rate-hits-cleanup');
  end if;
  perform cron.schedule('waggle-rate-hits-cleanup', '17 3 * * *', $job$ delete from public.rate_hits where at < now() - interval '2 days'; $job$);
end;
$$;
