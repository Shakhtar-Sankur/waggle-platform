-- Harden delete_own_account().
--
-- As shipped it is:
--
--   create function public.delete_own_account() returns void
--   language plpgsql security definer set search_path to 'public'
--   as $$ begin delete from auth.users where id = auth.uid(); end; $$
--
-- with EXECUTE granted to anon.
--
-- Called without a session, auth.uid() is null, so `where id = null` matches no
-- rows and nothing is deleted — verified against production with an anonymous
-- POST, which returned 204 and removed nothing. So this is not a live data-loss
-- bug, and it is worth fixing anyway for two reasons.
--
-- FIRST, the only thing standing between an unauthenticated caller and a DELETE
-- on auth.users is SQL's null-comparison rule. That is correct today and it is
-- one careless edit away from not being — a coalesce(), a changed predicate, an
-- added OR, and a SECURITY DEFINER function that anon can call starts matching
-- rows. Safety should be stated, not inherited from a comparison's semantics.
--
-- SECOND, and this is the part that affects real people: it answers 204 SUCCESS
-- to a caller whose session has expired. The app reads that as "account
-- deleted" and moves on, so a driver who asked to be erased is told it worked
-- while their row is still there. Account deletion is a GDPR right in a good
-- number of the launch markets, and silently reporting success is the one
-- failure mode that cannot be noticed from the outside.
--
-- create_thread() in chat_thread_atomic.sql already guards exactly this way;
-- this brings the two into line.
--
-- Safe to run more than once, like every other file in this folder.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Explicit, and it raises rather than returning quietly. A caller with a
  -- dead session now gets an error it can show the driver, instead of a
  -- success it cannot distinguish from the real thing.
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  delete from auth.users where id = v_uid;
end;
$$;

-- anon has no business calling this at all. Deleting an account requires being
-- signed into it, and that is precisely what `authenticated` means.
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
