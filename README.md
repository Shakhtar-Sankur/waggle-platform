# Buzz Buzz

**A tracking and community app for gig workers — free for the people who use it.**

A Swiggy rider, an Uber driver and an Amazon Flex courier are often the same person, but no platform
connects those identities. More than half of gig workers operate across multiple platforms at once,
and each platform sees only its own slice. Buzz Buzz is the professional and social layer that sits
across all of them.

Built at Gigzen. Tested by [Populace](https://github.com/Shakhtar-Sankur/populace), which was written for
this app and then became a product of its own.

**Website:** https://shakhtar-sankur.github.io/buzz-buzz/ &nbsp;·&nbsp;
**Download:** [BuzzBuzz-v1.5.apk](https://shakhtar-sankur.github.io/buzz-buzz/BuzzBuzz-v1.5.apk)
(7.9 MB, Android 8.0+) &nbsp;·&nbsp;
**Test report:** [gigzen.github.io/test-report](https://shakhtar-sankur.github.io/gigzen/test-report.html)

## Where it stands

- **16 languages** at full parity, right-to-left included; **27 currencies** across **49 countries**,
  selected from where the rider actually is.
- **Version 1.5 (build 6)**, signed release, in closed testing. Not yet publicly on Google Play.
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
| **16 languages** | Including right-to-left Arabic, with currency and language auto-selected by region. |

## Stack

React 18 · TypeScript · Vite · Capacitor (Android) · Zustand · Leaflet · Supabase (Postgres, Auth,
Realtime, Edge Functions)

## Scale

```
13,235   lines of TypeScript, CSS and SQL
    17   Postgres tables
    48   row-level-security policies
    16   languages, one of them RTL
     9   screens · 7 stores · 6 services
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
schema.sql              tables, row-level security, the core policies
social_features.sql     likes, comments, connections
direct_messages.sql     one-to-one threads
groups.sql              joinable groups
post_photos.sql         image column on posts
presence.sql            last_seen
read_receipts.sql       message status transitions
realtime.sql            adds tables to the realtime publication
notify_social.sql       triggers for like/comment/message notifications
daily_reset.sql         pg_cron job zeroing daily stats at local midnight
```

`privacy_lockdown.sql` is a **migration for projects created before the policies were tightened**.
A fresh `schema.sql` is already closed; run the lockdown only if your project predates it.

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
accounts. Not yet published to the Play Store.

## Licence

Licensed under the GNU Affero General Public License v3.0. See `LICENSE`.

In short: you may use, modify and redistribute this, including over a network,
provided your derivative is released under the same licence.
