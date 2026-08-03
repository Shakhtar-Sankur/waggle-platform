# Screenshots for the Play Store

Google Play requires **at least 2** phone screenshots (up to 8). During QA the app
was verified on these screens — each makes a strong store screenshot:

1. **Home / Today's Journey** — distance, active time, earnings, Start Tracking
2. **Live Map (Routes)** — Manila map with nearby drivers + "3 friends nearby"
3. **Community feed** — posts, tabs (Feed/Discover/Friends/Challenges)
4. **Messages** — group chat with the driver crew
5. **Profile** — vehicle maintenance + achievements
6. **Notifications** — activity list

## Easiest way to capture (real device)

1. Install the debug/release build on your phone.
2. Open each screen above and take a screenshot (Power + Volume Down).
3. Transfer the PNGs here and upload them in Play Console → Store listing → Phone
   screenshots.

## Or capture from the browser build

```powershell
# from i-want-to-make-one-app
$env:Path = "C:\Program Files\nodejs;" + $env:Path
corepack pnpm build
corepack pnpm exec vite preview --port 4173
```

Open <http://127.0.0.1:4173>, press **F12 → Ctrl+Shift+M** (device toolbar), pick a
phone size (e.g. Pixel 7), and use the browser's screenshot tool on each screen.

## Tips
- Use a **consistent device frame** and portrait orientation (9:16).
- Optionally add a one-line caption band at the top of each (e.g. "Track every trip").
- The **feature graphic** (1024×500) and **512×512 icon** are separate — create those
  in Canva/Figma using the app's orange brand color (`#f4511e`).
