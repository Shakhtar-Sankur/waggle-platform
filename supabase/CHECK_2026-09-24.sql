-- ============================================================================
-- READ-ONLY CHECK. Changes nothing. Run it on a project BEFORE and AFTER the
-- run file, in the Supabase SQL Editor, and compare.
--
-- Before: tells you which run file this project needs.
--   * every row true up to "save_my_location" and the rest false -> TEST file
--   * "save_my_location" false and everything below it false   -> PRODUCTION file
-- After: every row should be true.
-- ============================================================================

select part, present from (values
  (1, 'jobs table (base backend)',                         to_regclass('public.jobs') is not null),
  (2, 'accept_job (waggle_gig_setup.sql)',                 exists (select 1 from pg_proc where proname = 'accept_job')),
  (3, 'save_my_location (security_fixes.sql)',             exists (select 1 from pg_proc where proname = 'save_my_location')),
  (4, 'businesses (business.sql)',                         to_regclass('public.businesses') is not null),
  (5, 'job codes and steps (business.sql)',                exists (select 1 from pg_proc where proname = 'confirm_delivery')),
  (6, 'one door for every job (business.sql, 24 Sep)',     exists (select 1 from pg_proc where proname = '_post_job_core')),
  (7, 'orders from customers (business_v2.sql)',           to_regclass('public.orders') is not null),
  (8, 'strict verification log (business_v2.sql)',         to_regclass('public.business_review_log') is not null),
  (9, 'invoices and payments (business_v2.sql)',           to_regclass('public.invoices') is not null and to_regclass('public.payments') is not null),
  (10, 'item details and stock (business_v2.sql)',         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catalog_items' and column_name = 'options')),
  (11, 'coupons (business_v2.sql)',                        to_regclass('public.coupons') is not null),
  (12, 'group orders (business_v2.sql)',                   exists (select 1 from pg_proc where proname = 'place_group_order')),
  (13, 'Waggle app: nearby shops and search',              exists (select 1 from pg_proc where proname = 'nearby_shops') and exists (select 1 from pg_proc where proname = 'search_nearby')),
  (14, 'private buckets for ID papers',                    (select count(*) = 2 from storage.buckets where id in ('worker-docs', 'business-docs') and not public)),
  (15, 'public buckets for product and review photos',     (select count(*) = 2 from storage.buckets where id in ('catalog-photos', 'review-photos') and public))
) as t(n, part, present)
order by n;
