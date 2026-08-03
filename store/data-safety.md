# Play Console — Data Safety Form Answers

Fill this in Play Console → **App content → Data safety**. Answers below match what
the app actually does. Update if you change features.

## Overview answers
- **Does your app collect or share any of the required user data types?** → **Yes**
- **Is all user data encrypted in transit?** → **Yes** (HTTPS to Supabase/Firebase)
- **Do you provide a way for users to request data deletion?** → **Yes**
  (in-app "Delete Account" + email request)

## Data collected

| Data type | Collected | Shared | Purpose | Optional? |
|-----------|-----------|--------|---------|-----------|
| Name | Yes | Yes* | Account management, App functionality | Required |
| Phone number | Yes | No | Account management | Required |
| Precise location | Yes | Yes* | App functionality (tracking), Personalization | **Optional** (only while tracking) |
| Messages (in-app) | Yes | Yes* | App functionality (chat/community) | Optional |
| App activity (posts, settings) | Yes | Yes* | App functionality | Optional |
| Device/other IDs (push token) | Yes | No | App functionality (notifications) | Optional |

\* "Shared" here means visible to other users through community/chat features you opt
into — **not** sold to third parties. On the form, mark these as **collected** and,
for the community-visible ones, **shared**; select purpose "App functionality".

## Security practices (check these)
- ☑ Data is encrypted in transit
- ☑ Users can request that data be deleted
- ☑ You follow the Play Families / target-age policy (app is 18+)

## Notes
- Location is **not** collected in the background — only during an active tracking
  session the user starts. Make sure this is reflected: under Location, purpose =
  "App functionality" and it is **user-initiated**.
- You do **not** collect financial info, contacts, photos (unless you enable the
  camera attachment feature — if a user attaches an image to chat, add "Photos" →
  "App functionality", Optional).
