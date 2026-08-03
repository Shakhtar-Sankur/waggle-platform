# Push Notifications — Full Setup

This wires real push notifications end-to-end:
**chat message → database trigger → `send-push` edge function → Firebase (FCM) → phone.**

Local/in-app notifications already work without any of this. Follow these steps
only when you want notifications delivered while the app is closed.

---

## 1. Create a Firebase project (free)

1. Go to <https://console.firebase.google.com> → **Add project**.
2. Add an **Android app** with package name **`com.masayaako.driver`**
   (this must match exactly — it is tied to the signing keystore).
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

```bash
supabase login
supabase link --project-ref <your-project-ref>

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
  'https://<your-project-ref>.supabase.co/functions/v1/send-push',
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
