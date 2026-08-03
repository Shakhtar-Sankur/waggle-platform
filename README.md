# Buzz Buzz

**A tracking and community app for gig workers — free for the people who use it.**

A Swiggy rider, an Uber driver and an Amazon Flex courier are often the same person, but no platform
connects those identities. More than half of gig workers operate across multiple platforms at once,
and each platform sees only its own slice. Buzz Buzz is the professional and social layer that sits
across all of them.

Built at Gigzen. Tested by [Populace](https://github.com/Shakhtar-Sankur/populace), which was written for
this app and then became a product of its own.

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
and publishable key. The SQL in `supabase/` builds the schema and policies — run `schema.sql` first,
then the feature migrations. `supabase/PUSH_SETUP.md` covers Firebase push, which stays off behind
`VITE_ENABLE_PUSH` until configured.

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

All rights reserved. Published for reading, not for reuse.
