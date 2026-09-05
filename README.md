# Waggle

**A tracking and community app for gig workers — free for the people who use it.**

A Swiggy rider, an Uber driver and an Amazon Flex courier are often the same person, but no platform
connects those identities. More than half of gig workers operate across multiple platforms at once,
and each platform sees only its own slice. Waggle is the professional and social layer that sits
across all of them.

Built at Gigzen. Tested by [Populace](https://github.com/Shakhtar-Sankur/populace), which was written for
this app and then became a product of its own.

**Website:** https://shakhtar-sankur.github.io/waggle/ &nbsp;·&nbsp;
**Download:** [Waggle-1.0.apk](https://shakhtar-sankur.github.io/waggle/Waggle-1.0.apk)
(8.2 MB, Android 7.0+) &nbsp;·&nbsp;
**Test report:** [gigzen.github.io/test-report](https://shakhtar-sankur.github.io/gigzen/test-report.html)

## Where it stands

- **43 languages**, right-to-left included; **61 currencies** across **83 countries** and
  **33 gig platforms**, selected from where the rider actually is.
- **Version 1.0 (build 2)**, signed release, uploaded to Google Play internal testing.
  Not yet publicly on Google Play.
- Verified by a six-user concurrent simulation against the live backend: **400 API calls, no
  failures**, 13/13 adapter methods covered, every test account deleted afterwards.
- The run before that one found **five real defects** in this app after it had already passed a
  full manual test — including one that stopped account creation entirely.

The paths that still need real handsets — push notification delivery, and one rider watching
another move on the map — are written up in [`TWO_USER_TEST.md`](TWO_USER_TEST.md) and have not
been run. The test report says so too.

---

## What it does

| | |
|---|---|
| **GPS trip tracking** | Live distance, duration and earnings while you drive, with route history and a daily goal ring. Resets at local midnight — enforced both client-side and by a scheduled server job. |
| **Community feed** | Posts with photos, likes, comments, tagging, and joinable groups. |
| **Messaging** | One-to-one and group chat with presence, last-seen, and read receipts that progress ✓ → ✓✓ → blue ✓✓. |
| **Worker dashboard** | Earnings, vehicle maintenance, challenges and a leaderboard. |
| **Activity** | One place for saved posts, liked posts, your own posts, and the users you have blocked. |
| **Report and block** | On any post, comment, profile and chat thread, with the block offered at the point of reporting. |
| **Notification preferences** | Per-category switches, promotional included, stored server-side so they hold across devices. |
| **43 languages** | Including right-to-left Arabic, Urdu and Hebrew, with currency and language auto-selected by region. |

## Stack

React 18 · TypeScript · Vite · Capacitor (Android) · Zustand · Leaflet · Supabase (Postgres, Auth,
Realtime, Edge Functions)

## Scale

```
31,459   lines of TypeScript, CSS and SQL
    24   Postgres tables
    54   row-level-security policies
    43   languages, three of them RTL
    10   screens · 8 stores · 14 services
```

## Running it

```bash
pnpm install
pnpm dev
```

Point it at a Supabase project by copying `.env.example` to `.env` and filling in your project URL
and publishable key.

### Database setup, in order

```
schema.sql                tables, row-level security, the core policies
social_features.sql       likes, comments, connections
direct_messages.sql       one-to-one threads
groups.sql                joinable groups
post_photos.sql           image column on posts
photo_storage.sql         storage bucket and its policies
presence.sql              last_seen
read_receipts.sql         message status transitions
chat_reply_reactions.sql  replies and emoji reactions on messages
chat_voice_notes.sql      voice messages
chat_thread_atomic.sql    thread creation without a race
people_search.sql         search across profiles
work_apps_global.sql      the 33 gig platforms, shared across installs
reposts.sql               reposting a feed post
stories.sql               24-hour stories, expiry enforced in the read policy
report_and_block.sql      content_reports and user_blocks
bookmarks.sql             saved posts
notification_prefs.sql    per-category notification switches
user_content_control.sql  editing and deleting your own content
delete_account_guard.sql  delete_own_account(), caller-only
route_daily_distance.sql  per-day distance aggregated in SQL, not on the client
realtime.sql              adds tables to the realtime publication
notify_social.sql         triggers for like/comment/message notifications
daily_reset.sql           pg_cron job zeroing daily stats at local midnight
```

`privacy_lockdown.sql` is a **migration for projects created before the policies were tightened**.
A fresh `schema.sql` is already closed; run the lockdown only if your project predates it.

> **`00_complete_backend.sql` is behind the list above.** It bundles everything up to
> mid-August into one idempotent file, but it predates stories, reposts, report and block,
> bookmarks, notification preferences and `route_daily_distance`. Run it first if you like the
> single-file route, then run those files on top — or work down the ordered list instead.

> **Why the read policies require a session.** The publishable key ships inside the APK and can be
> extracted from it in minutes, so in practice "anonymous" means anyone who downloads the app. These
> tables hold phone numbers and live GPS positions. Read access therefore requires an authenticated
> session, `profiles.phone` is revoked from the API entirely, and the community map honours each
> driver's "Share stats" switch at the database level rather than only in the UI.

`supabase/PUSH_SETUP.md` covers Firebase push, which stays off behind `VITE_ENABLE_PUSH` until
configured.

### Authentication, and what it does not yet do

Sign-in is phone plus password. The phone number is mapped to a synthetic email
(`919776194201@masaya.local`) because Supabase's password provider is email-based; the mapping is
deterministic, so the login identifier for any phone number is predictable.

**There is no phone verification.** Sending an SMS one-time code needs a paid provider wired into
Supabase phone auth, which is not set up here. The practical consequence is that someone can
register an account against a phone number they do not own, provided nobody has registered it
already — an existing account cannot be taken over, but an unclaimed number can be squatted on.

For a community app where a driver's identity is their phone number, OTP is the right fix and is the
main thing standing between this and a real launch. The client enforces a minimum password of eight
characters with a letter and a digit; treat that as a user-experience nicety rather than a control,
since it lives in the client.

Android build:

```bash
pnpm build
pnpm android:sync
cd android && ./gradlew bundleRelease
```

Signing config is read from `android/local.properties`, which is not in this repository. Neither is
the upload keystore, `.env`, or `google-services.json` — copy
`android/app/google-services.json.example` and fill in your own Firebase values.

## A bug worth writing down

Chat reads failed silently across the entire app. The cause was a row-level-security policy on
`chat_thread_members` that recursed into itself: the policy guarding the table had to read that same
table to evaluate. Postgres reported infinite recursion, and because the failure surfaced as an empty
result rather than an error, every chat screen simply rendered blank.

The fix is a `SECURITY DEFINER` helper, `is_thread_member`, which breaks the cycle by evaluating
membership outside the policy's own RLS context. It lives in `supabase/fix_chat_rls.sql` and is
folded into `schema.sql`.

Two follow-on policies were needed before chat worked end to end: the creator of a thread has to be
able to `SELECT` the thread they just inserted, and members have to be able to `UPDATE`
`chat_threads.updated_at` when sending a message.

## Status

Feature-complete, signed for release, and verified end to end against a live backend with two real
accounts. The signed AAB is uploaded to Google Play internal testing; not yet published publicly.

Two things have not been exercised on real hardware and are written up as untested rather than
claimed: push notification delivery, and one rider watching another move on the map.

## Licence

Licensed under the GNU Affero General Public License v3.0. See `LICENSE`.

In short: you may use, modify and redistribute this, including over a network,
provided your derivative is released under the same licence.
