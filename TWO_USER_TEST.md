# Buzz Buzz — Two-User Live Test

Everything in the app that involves *another person* can only be proven with two
real accounts. This is that test. It takes about 20 minutes.

**You need:** two devices (or one phone + one desktop browser), and two accounts.
Call them **A** and **B**. Use throwaway numbers you can delete afterwards.

> Why you and not me: I don't create accounts or enter passwords, so I can't be
> either user. Everything below is the set of paths I could not verify.

---

## Setup

1. Install the current `BuzzBuzz.apk` on device A. Open B in Chrome (or a second phone).
2. Sign up on both. Accept the location + privacy consent on both.
3. On each, pick a work platform (A: Uber, B: Swiggy — deliberately two of the new ones).

**✅ Checkpoint 1 — the new platforms actually save.**
Close and reopen the app on A. The platform must still say **Uber**.
*If it reverted to blank, `work_apps_global.sql` did not take.*

---

## 1. Do they see each other?

4. On A: **Community → Friends**. B should appear in "People you may know".
5. On A: tap **Add**. On B: refresh → the request should appear.
6. On B: **Accept**.

**✅ Checkpoint 2 — connection + live notification.**
A should get a "New connection request"/accepted notification **without reloading**.
*This is the realtime test. If it only appears after a reload, realtime is broken —
tell me, because the privacy lockdown tightened the policies realtime runs under.*

---

## 2. Posting, liking, commenting

7. On A: post "Testing from A". On B: refresh Community.
8. On B: **Like** it, then **Comment** "seen".
9. On A: check the notification bell.

**✅ Checkpoint 3** — A received "B liked your post" and "B: seen".

10. On A: tap the **trash icon** on your own post → confirm.
11. On B: reload.

**✅ Checkpoint 4 — delete actually reaches the server.**
The post must be gone on **B** too, not just on A.
*If it reappears on A after a few seconds, `user_content_control.sql` did not take.*

12. On B: open the **⋯** on one of A's posts — it must say **Hide post**, NOT delete.
    *(You must never be able to delete someone else's post.)*

---

## 3. Messaging — the tick progression

13. On A: **Friends → B → Message**. Send "hello".
14. Watch the tick under your message on A:

| State | Meaning | When |
|---|---|---|
| ✓ grey | sent | immediately |
| ✓✓ grey | delivered | B's app fetched it (B open, chat list visible) |
| ✓✓ **blue** | read | B has the conversation **open** |

**✅ Checkpoint 5** — you see all three states, in that order.
*A message that is blue instantly is the old bug; it should not happen.*

15. On A: tap the small **trash** on your own message → confirm. On B: it disappears.
16. On B: confirm there is **no** delete control on A's messages.

---

## 4. Presence (WhatsApp-style)

17. With the chat open on both, A's header should show **online** for B.
18. Background the app on B (home button) and wait ~2 minutes.

**✅ Checkpoint 6** — A now shows **"last seen 2m"**, not "online".

---

## 5. Location + the privacy switch

19. On both: **Start Tracking**, move ~200 m (or drive).
20. On A: **Routes → Maps**. B's marker should appear on the map.

**✅ Checkpoint 7** — you can see each other on the map.

21. On B: **Profile → Settings → turn OFF "Share stats with community"** → Save.
22. On A: wait ~15 s and reload the map.

**✅ Checkpoint 8 — the privacy switch is real.**
B must **disappear** from A's map and from the Challenges leaderboard.
*This was a placebo switch until now; it must actually work.*

23. On B: turn it back on, drive a little → B reappears on A's map.

---

## 6. Challenges + groups

24. On both: **Routes → Challenges**. Progress should reflect the distance you just drove.
25. On A: **Create Challenge** → "Test 5 km", track by Distance, target 5 → it appears with "Yours".
26. On A: **Community → Groups** → Join "Grab Drivers Manila". On B: reload Groups.

**✅ Checkpoint 9 — real member counts.**
B must see **1 member** (not a made-up number, not "unavailable").

---

## 7. Push while the app is CLOSED

Only works after the Firebase steps in `supabase/PUSH_SETUP.md`.

27. **Fully close** the app on B (swipe from recents).
28. On A: send B a message.

**✅ Checkpoint 10** — B's phone shows a notification with the app closed.
*If nothing arrives, Firebase isn't wired yet — expected until you do that setup.*

---

## Afterwards

- Delete both test accounts: **Profile → Delete Account** on each.
- That cascades their profile, posts, messages and location rows automatically.

---

## Report back

For any checkpoint that fails, tell me **the number** and what you saw instead.
The two most likely to fail, and the ones I most want to hear about:

- **Checkpoint 2** (realtime) — the privacy lockdown changed the policies realtime depends on.
- **Checkpoint 4** (delete reaching the server) — depends on `user_content_control.sql`.
