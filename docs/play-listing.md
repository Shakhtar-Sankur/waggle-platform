# Google Play listing — Waggle

Everything here is checkable against the app. Play compares the Data Safety
section to what the binary actually does, and a listing that overstates is a
removal later rather than a rejection now.

`com.gigzen.waggle` · versionCode 2 · versionName 1.0 · targetSdk 36 · minSdk 24

---

## Title (30 characters max)

```
Waggle: Gig Driver Earnings
```
27 characters.

## Short description (80 characters max)

```
Track every kilometre you drive and what it earned. Works without a signal.
```
74 characters. The second sentence is the one that matters to a driver on a
prepaid plan, so it is not buried.

## Full description (4000 characters max)

```
Waggle counts the kilometres you actually drive and tells you what they earned.

WHAT IT DOES

Trip tracking that keeps counting
Start a trip and lock your phone. Recording continues with the screen off, so
your distance keeps climbing while the phone is in your pocket. Your route is
matched to real roads rather than drawn as straight lines between GPS pings, and
it is coloured by how fast you were moving, so you can see where you were stuck.

Earnings you can check
Set your rate per kilometre and the daily goal you are working towards. Waggle
multiplies the rate by the distance it measured and shows the total, your rate
per hour, and how far through the goal you are. Every figure comes from your own
trips.

A week you can look back on
Every day you drive is kept, so you can see the last seven days side by side and
what each one earned. These are measured from your recorded trips, not today's
pace multiplied out — a slow morning does not become a bad week.

It ignores what did not happen
A phone sitting still reports GPS that wanders by several metres. Waggle
discards movement below that noise floor, rejects fixes too imprecise to place
you, and refuses jumps no vehicle could make. You are not paid for a parked
phone drifting.

Works without a signal
Posts and messages written underground or in a dead spot are kept on the device
and sent when the connection returns. Nothing is lost because the network was.

A place for drivers
A feed for road conditions and what is happening in your area. Group and direct
chat with read receipts, voice notes and photos. See connected drivers near you
and what platform they are working.

Your platform, your region
33 gig platforms across 83 countries, with the currency and the platform list
resolved from where you are — 61 currencies supported. 43 languages, including
right-to-left for Arabic, Urdu and Hebrew.

BUILT SMALL ON PURPOSE

8.2 MB to download, and it runs on Android 7.0 and up. This is built for a
mid-range phone on a prepaid plan, because that is what most of the people it is
for are carrying.

PRIVACY

Your phone number is not readable by other drivers — that is enforced by the
database, not hidden in the interface. Your location is shared only with drivers
you are connected to, and only while you choose to share it.

Messages are stored on Gigzen's servers. Only people in a chat can read them.
They are not end-to-end encrypted, and the app says so where you can see it
rather than in a policy page.

Free for workers. There is no paid tier.

Waggle is made by Gigzen Private Limited.
```

Roughly 1,950 characters, well inside the limit. Left short deliberately: the
first two lines are what shows before "read more".

---

## Data Safety — answers taken from the schema, not from memory

Every row below is a column that exists in the production database.

| Data type | Collected | Shared | Why | Optional |
|---|---|---|---|---|
| **Approximate & precise location** | Yes | Yes | App functionality — trip distance and earnings; shown to connected drivers | Sharing with others is optional (`share_stats`), tracking requires it |
| **Phone number** | Yes | No | Account management — it is the sign-in identifier | Required |
| **Name** | Yes | Yes | App functionality — shown on posts and in chats | Required |
| **Photos** | Yes | Yes | App functionality — profile picture, posts, chat attachments | Optional |
| **Voice recordings** | Yes | Yes | App functionality — voice notes in chat | Optional |
| **Messages** | Yes | Yes | App functionality — chat between drivers | Optional |
| **App activity (posts, likes)** | Yes | Yes | App functionality — the community feed | Optional |
| **Device ID (push token)** | Yes | No | App functionality — delivering notifications | Optional |

Declare in addition:
- **Encrypted in transit:** yes — everything goes over HTTPS.
- **Users can request deletion:** yes — Profile → Delete Account, which is
  behind a confirmation and removes the account.
- **Data is not sold**, and there is no advertising or analytics SDK in the
  build.

Do not tick "end-to-end encrypted". It is not, the app says so on the chat
screen, and claiming it here would contradict the product.

## Location permission declaration

Not required. The app requests `ACCESS_FINE_LOCATION` and
`ACCESS_COARSE_LOCATION` only, and keeps recording with the screen off through a
foreground service typed `location` — started while the app is visible, with a
notification the driver can see. `ACCESS_BACKGROUND_LOCATION` is deliberately
not requested, so the background-location declaration form and its review do not
apply.

If asked why a foreground service is used: the driver starts a trip explicitly,
the notification states that recording is running, and stopping the trip stops
the service.

## Assets

- **Icon** — 512×512 PNG, from `android/app/src/main/res` (already in the app).
- **Feature graphic** — 1024×500, `docs/play-feature-graphic.png`.
- **Phone screenshots** — `docs/play-screenshots/`: home, map, community,
  friends, messages, profile. 780×1520 (1.949:1), 24-bit PNG, captured from the
  current build.

  Not `gigzen-website/shots/`. That set is 720×1520 — 2.111:1, over Play's 2:1
  cap — and was taken on 29 August, so it still shows the Daily Goal card that
  has since been removed and predates the 7-day record entirely.

## Content rating

Answer the questionnaire honestly. The app has user-generated content (feed
posts and chat), so expect to declare that and to confirm there is a way to
report or block. That is the one answer likely to affect the rating.

## Still to decide before submitting

- Category: **Maps & Navigation** fits the tracking, **Business** fits the
  earnings. Maps & Navigation is the closer match.
- Countries: everywhere the platform list covers, or start with India and widen.
- Contact email.
- **Privacy policy URL:** `https://shakhtar-sankur.github.io/gigzen/privacy.html`

  Not the in-app `/privacy` route. That is a hash route inside a single-page
  app: it answers 200 for any path, so a reviewer following it may be shown the
  application rather than a policy, and `…/waggle/privacy` is a plain 404. The
  company page is a real document at a real URL, 14,768 characters, and it names
  Waggle and covers location, phone number, photos, messages and deletion —
  which is what Play checks it against.
