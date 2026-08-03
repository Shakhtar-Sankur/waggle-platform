# Masaya Ako — Play Store Release Checklist

## ✅ Already done (by tooling)
- [x] App builds cleanly (web + Android)
- [x] Signed **release AAB** produced: `android/app/build/outputs/bundle/release/app-release.aab`
- [x] Strong upload keystore generated: `android/app/masayaako-upload.keystore`
- [x] Signature verified (`jarsigner -verify` → "jar verified")
- [x] Store listing text, privacy policy, data-safety, content-rating drafts in `store/`

## 🔴 CRITICAL — do this first: back up your signing key
Your upload key lives at `android/app/masayaako-upload.keystore` and its password is in
`android/local.properties`. **If you lose these, you can never update the app again**
(you'd have to publish a brand-new listing).

- [ ] Copy `masayaako-upload.keystore` to a safe place (password manager / encrypted cloud).
- [ ] Copy the password from `android/local.properties` into your password manager.
- [ ] Confirm `.gitignore` excludes `*.keystore` and `local.properties` (it does) — **never commit them.**

> Prefer a password not seen in this session? Regenerate before you ever publish:
> ```
> keytool -genkeypair -v -keystore masayaako-upload.keystore -alias masayaako \
>   -keyalg RSA -keysize 2048 -validity 10000
> ```
> Then update the 4 `release.*` lines in `android/local.properties` and rebuild.

## 🟡 Before you build the final AAB — connect the backend
Right now `.env` is empty, so the app runs in **offline/demo mode** (each user is
alone; no real accounts, chat, or shared data). For a real multi-user launch:

- [ ] Create the Supabase project and run `supabase/schema.sql`, then `supabase/production.sql`.
- [ ] Put your real `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`.
- [ ] (Optional) Set up push per `supabase/PUSH_SETUP.md` (Firebase + `google-services.json`).
- [ ] Decide what to do with **demo/seeded content** (see "Honest launch notes" below).
- [ ] Rebuild the signed AAB: `pnpm android:sync` then in `android/`: `gradlew bundleRelease`.

## 🟢 Play Console steps (you must do these — needs your account)
- [ ] Create a Google Play Developer account ($25 one-time, ID verification).
- [ ] Create the app → package name `com.masayaako.driver`.
- [ ] **Main store listing** — paste from `store/store-listing.md`; upload icon, feature graphic, screenshots.
- [ ] **Privacy policy** — host `store/privacy-policy.md` and paste the URL (App content → Privacy policy).
- [ ] **Data safety** — answer per `store/data-safety.md`.
- [ ] **Content rating** — answer per `store/content-rating.md`.
- [ ] **App access** — provide a test login if sign-in is required for review.
- [ ] Upload `app-release.aab` to **Internal testing** first → test on real devices.
- [ ] Promote to **Production** when happy. First review can take a few days.

## Version bumps for future updates
Each new upload needs a higher `versionCode`. Edit `android/app/build.gradle`:
```
versionCode 2       // increment every release
versionName "1.1"   // human-readable
```

## Honest launch notes (read these)
These aren't blockers, but real users will see them — decide before you publish:
1. **Demo content is fake.** Seeded community posts, "friends nearby", achievements
   (e.g. "Top 5% in your area", "1000+ quick pickups"), and the sample job feed are
   placeholder data in `src/data/seed.ts`. Real users start with no such history —
   consider hiding or emptying these until real data exists.
2. **Auth has no phone verification (OTP).** Anyone can register with any phone
   number + password. Fine for a soft launch; add OTP before scaling to reduce spam.
3. **"Jobs" are simulated**, not pulled from Grab/Angkas/etc. (those aren't open to
   third parties). Position the app as a **tracking + community companion**, which is
   what it truly is — the store description already does this.
4. **Map tiles** use OpenStreetMap's free servers. Fine for launch; switch to a paid
   tile provider (MapTiler/Mapbox) if usage grows, per their fair-use policy.
