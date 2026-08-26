import { useEffect } from "react";

/** The five destinations in the tab bar. Each one owns a colour. */
export type BandSection = "home" | "community" | "routes" | "messages" | "profile";

/**
 * Marks a screen as opening on a brand-coloured band, and tells the CSS how far
 * that band has to climb to sit behind the shared header.
 *
 * The header is a sibling rendered above the screen by AppShell, so a screen
 * cannot reach it any other way. Two things come out of this hook:
 *
 * - `body[data-band]`, which the stylesheet uses to turn the header's wordmark
 *   and icons white while they are over the band, and to give the header the
 *   brand colour once the band has scrolled away rather than the white it would
 *   otherwise collapse to. A marker on <body> rather than `:has()`, because this
 *   runs in an Android WebView and a layout that quietly loses its contrast on
 *   an older device is not worth the elegance.
 *
 *   The value is the section, so the stylesheet can give each destination its
 *   own colour. Five screens sharing one orange made every one of them look
 *   like the same screen with different words on it; you cannot tell at a
 *   glance whether a tap landed. Colour is the fastest signal there is —
 *   it arrives before you have read anything — so each tab now owns a hue and
 *   moving between them is legible in peripheral vision.
 *
 *   It is never the ONLY signal: the tab bar still marks the active item with
 *   a label, a filled icon and a pill, because roughly one man in twelve cannot
 *   separate red from green, and a scheme that speaks only in colour says
 *   nothing to them.
 *
 * - `--band-pull`, the header's measured height. Hardcoding it worked on the
 *   machine it was written on and left a coloured seam everywhere else: the
 *   header carries the safe-area inset, so it is 89px on a plain viewport and
 *   taller on any phone with a notch.
 *
 * Both are cleared on unmount, so a screen without a band keeps its ordinary
 * dark header.
 */
export function useBrandBand(section: BandSection = "home"): void {
  useEffect(() => {
    document.body.dataset.band = section;

    const measure = () => {
      const header = document.querySelector(".app-header");
      const height = header ? Math.round(header.getBoundingClientRect().height) : 88;
      document.documentElement.style.setProperty("--band-pull", `${height}px`);
    };

    measure();
    // The inset changes on rotation, and on Android when the keyboard opens.
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      delete document.body.dataset.band;
      document.documentElement.style.removeProperty("--band-pull");
    };
    // `section` is in the deps: switching tabs without unmounting (which the
    // shell does when it keeps screens alive) must repaint the band.
  }, [section]);
}
