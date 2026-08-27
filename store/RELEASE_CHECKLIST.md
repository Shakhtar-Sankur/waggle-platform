# Waggle — Play Store Release Checklist

App name **Waggle** · store listing **Gigzen Waggle** · package `com.gigzen.waggle`

## ✅ Already done (by tooling)
- [x] App builds cleanly (web + Android), `tsc --noEmit` included
- [x] Signed release APK produced and its identity read back from the built file
- [x] Firebase registered for `com.gigzen.waggle` in project `buzz-buzz-2390c`
- [x] Launcher icons regenerated at all five densities from the Waggle mark
- [x] 24 languages, scripts verified rendering with no missing glyphs
- [x] Store listing text, privacy policy, data-safety, content-rating drafts in `store/`

## 🔴 DO THIS BEFORE YOUR FIRST UPLOAD — replace the signing key

The current upload key is `android/app/masayaako-upload.keystore`, and its
certificate reads:

```
CN=Masaya Ako, OU=Mobile, O=Masaya Ako, L=Manila, ST=Metro Manila, C=PH
```

Wrong brand, wrong company, wrong country — Gigzen Private Limited is in
Bhubaneswar, India. Play shows this in App Signing, and **after the first
upload the key is bound to the listing** and can only be changed by asking
Google support. Right now it costs one command.

This step is yours, not the tooling's: `keytool` prompts for a password, and a
production signing key should not have a password that has ever been typed into
an assistant session or written to a transcript.

1. From `android/app/`, run — it will prompt for a password twice:

   ```
   keytool -genkeypair -v -keystore gigzen-upload.keystore -alias gigzen \
     -keyalg RSA -keysize 4096 -validity 10000 \
     -dname "CN=Gigzen Private Limited, OU=Mobile, O=Gigzen Private Limited, L=Bhubaneswar, ST=Odisha, C=IN"
   ```

2. Update these four lines in `android/local.properties` (gitignored):

   ```
   release.keystore=gigzen-upload.keystore
   release.keystore.password=<the password you just set>
   release.key.alias=gigzen
   release.key.password=<the same password, unless you set a separate key password>
   ```

3. Rebuild and confirm the new certificate:

   ```
   cd android && ./gradlew assembleRelease
   apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
   ```

   The DN should now say Gigzen Private Limited.

- [ ] Generated `gigzen-upload.keystore`
- [ ] Updated the four `release.*` lines
- [ ] Verified the new DN in the built APK
- [ ] **Backed the keystore up** to a password manager or encrypted cloud —
      lose it and you can never update the app again
- [ ] Confirmed `.gitignore` still excludes `*.keystore` and `local.properties`
      (it does) — never commit either

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
- [ ] Create the app → package name `com.gigzen.waggle`.
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
