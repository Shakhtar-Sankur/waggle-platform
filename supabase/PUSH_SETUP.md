# Push Notifications — Full Setup

This wires real push notifications end-to-end:
**chat message → database trigger → `send-push` edge function → Firebase (FCM) → phone.**

Local/in-app notifications already work without any of this. Follow these steps
only when you want notifications delivered while the app is closed.

## Where this stands (re-checked 2026-08-28)

| Step | State |
|---|---|
| 1. Firebase Android app for `com.gigzen.waggle` | **done** — added to project `buzz-buzz-2390c`, new `google-services.json` in `android/app/`, `processReleaseGoogleServices` passes |
| 2. Service account key | **user-side** — a Firebase private key. Cannot be handled here, see below |
| 3. Deploy `send-push` + set its secrets | **NOT DONE** — this is the only thing stopping push |
| 4. `device_tokens` table on production | **done** — verified present |
| 5. `VITE_ENABLE_PUSH=true` | **done** — set in `.env.production` |

Step 3 verified again on 2026-08-28: `POST /functions/v1/send-push` against
production still answers `{"code":"NOT_FOUND"}`, which is what an undeployed
function returns — a deployed one answers `401` to an unauthenticated call.

### Why this step cannot be done for you

Two of its inputs are credentials:

- **`FCM_PRIVATE_KEY`** is the private key out of a Firebase *service account*
  JSON. It signs requests as your project. It should be pasted straight from
  the downloaded file into `supabase secrets set` and nowhere else — not into a
  chat, a commit, or a file in this repo.
- **Deploying** needs the Supabase CLI authenticated as you (`supabase login`,
  which opens a browser).

Everything that does not need a credential is already done: the function's code
is written, `device_tokens` exists on production, the client requests a token
and saves it, and `VITE_ENABLE_PUSH` is on.

### The four commands

From the repo root, once:

```
npm i -g supabase                # the CLI is not installed here
supabase login                   # opens a browser
supabase link --project-ref ypdaetbeexyepswyhbui
```

Then get the service account: Firebase console → project `buzz-buzz-2390c` →
Project settings → **Service accounts** → *Generate new private key*. That
downloads a JSON file containing `project_id`, `client_email` and `private_key`.

```
supabase secrets set FCM_PROJECT_ID="<project_id from the JSON>"
supabase secrets set FCM_CLIENT_EMAIL="<client_email from the JSON>"
supabase secrets set FCM_PRIVATE_KEY="<private_key from the JSON, newlines and all>"
supabase secrets set PUSH_WEBHOOK_SECRET="<any long random string you choose>"

supabase functions deploy send-push
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform —
do not set those yourself.

Delete the downloaded JSON afterwards; the secrets now live in Supabase.

### Confirming it worked

```
curl -i -X POST https://ypdaetbeexyepswyhbui.supabase.co/functions/v1/send-push
```

**401** means deployed (the function is refusing an unauthenticated caller,
which is correct). **404 NOT_FOUND** means it still is not there.

---

## 1. Create a Firebase project (free)

> ### ⚠ The package name changed — this step must be redone
>
> The app's `applicationId` is now **`com.gigzen.waggle`** (it was
> `com.masayaako.driver`). The `google-services.json` currently in `android/app/`
> is registered to the OLD package, and **the Android build will fail** until
> this is fixed:
>
> ```
> No matching client found for package name 'com.gigzen.waggle'
> ```
>
> Editing the package name inside `google-services.json` by hand does NOT work.
> The `mobilesdk_app_id` in that file is issued by Firebase per package, so a
> hand-edited file is rejected. The Android app has to be registered properly.
>
> **What to do** (in the EXISTING project `buzz-buzz-2390c` — do not make a new
> one, the server key and the `send-push` config stay valid):
>
> 1. Firebase console → project `buzz-buzz-2390c` → **Add app** → Android.
> 2. Package name: `com.gigzen.waggle`.
> 3. Download the new `google-services.json`, replace `android/app/google-services.json`.
> 4. The old `com.masayaako.driver` app can stay registered; it costs nothing and
>    keeps any existing test installs working until they are retired.

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Add an **Android app** with package name **`com.gigzen.waggle`**
   (this must match `applicationId` in `android/app/build.gradle` exactly).
3. Download **`google-services.json`** and place it in `android/app/google-services.json`.

> **The Gradle side is already done — you do not need to edit any build file.**
> `android/build.gradle` already has `classpath 'com.google.gms:google-services:4.4.4'`,
> and `android/app/build.gradle` auto-applies the plugin as soon as
> `google-services.json` exists. Dropping the file in is the whole step.

## 2. Get a service account (lets the server send pushes)

1. Firebase Console → ⚙ **Project settings** → **Service accounts** → **Generate new private key**.
2. This downloads a JSON file. You need three values from it:
   - `project_id`
   - `client_email`
   - `private_key`  (a long string starting with `-----BEGIN PRIVATE KEY-----`)

## 3. Deploy the edge function

Install the Supabase CLI (<https://supabase.com/docs/guides/cli>), then:

> **Check what you are linked to first.** There are three projects and only one
> is live:
>
> | ref | what it is |
> |---|---|
> | `ypdaetbeexyepswyhbui` | **production — deploy here** |
> | `jqepegeifmnfofeyebrz` | test project, safe to experiment against |
>
> There was a third, `rqzuuvlougzhynckvqzd`. It is retired and being left to
> pause and expire, and it should not appear anywhere in this repo again.
>
> It caused a specific trap worth remembering: the CLI's link file lived in
> `supabase/.temp/`, that directory was COMMITTED, and it pointed at the dead
> project. So a fresh clone inherited a CLI aimed at a database nobody uses,
> and `deploy` reported success while nothing arrived. `.temp/` is gitignored
> now and the stale link is gone, so the CLI errors with "not linked" instead
> of silently picking the wrong target.
>
> Run `supabase link --project-ref ypdaetbeexyepswyhbui` before deploying, and
> confirm with `supabase projects list` that the linked marker sits on the
> production row rather than trusting the CLI's own success message.

```bash
supabase login
supabase link --project-ref ypdaetbeexyepswyhbui   # production

# Set secrets (use the values from step 2). Keep the private key quotes exactly.
supabase secrets set FCM_PROJECT_ID="your-project-id"
supabase secrets set FCM_CLIENT_EMAIL="firebase-adminsdk-xxxx@your-project.iam.gserviceaccount.com"
supabase secrets set FCM_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
supabase secrets set PUSH_WEBHOOK_SECRET="pick-a-long-random-string"

# Deploy
supabase functions deploy send-push
```

> `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — do not set them.

## 4. Run the database hardening + trigger

In the Supabase SQL Editor, run **`supabase/production.sql`**, then insert one config row:

```sql
insert into private.push_config (id, function_url, webhook_secret)
values (
  1,
  'https://ypdaetbeexyepswyhbui.supabase.co/functions/v1/send-push',
  'pick-a-long-random-string'   -- MUST equal PUSH_WEBHOOK_SECRET above
)
on conflict (id) do update
  set function_url = excluded.function_url,
      webhook_secret = excluded.webhook_secret;
```

## 5. Enable push in the app, then rebuild

Push registration is **off by default** (registering without Firebase crashes Android).
Turn it on only after steps 1–4 above are done — add this line to `.env`:

```bash
VITE_ENABLE_PUSH=true
```

Then rebuild so the device registers for push:

```bash
pnpm android:sync
```

Log in on a real device → accept the notification permission → the app saves the
device's FCM token to `device_tokens`. Now sending a chat message to another user
delivers a push to their phone.

---

## Testing without the app

You can trigger a push directly:

```bash
curl -X POST 'https://<project-ref>.supabase.co/functions/v1/send-push' \
  -H 'x-webhook-secret: pick-a-long-random-string' \
  -H 'Content-Type: application/json' \
  -d '{"userId":"<a-user-uuid>","title":"Test","body":"Hello from FCM"}'
```

## Reusing `send-push` for other notifications

The function is generic. From any server context (another edge function, a cron
job, an admin tool) you can push job broadcasts, promos, or announcements:

```json
{ "userId": "<uuid>", "title": "New job nearby", "body": "₱265 • BGC → Makati", "data": { "kind": "job" } }
```

## Troubleshooting

- **No push received:** confirm `device_tokens` has a row for that user, the
  `PUSH_WEBHOOK_SECRET` matches `private.push_config.webhook_secret`, and
  `google-services.json` is in `android/app/`.
- **Function logs:** `supabase functions logs send-push`.
- **`sent: 0, No devices registered`:** the user never granted notification
  permission or the app wasn't rebuilt after adding Firebase.
