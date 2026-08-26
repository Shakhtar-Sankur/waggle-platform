import { useEffect } from "react";

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
 * - `--band-pull`, the header's measured height. Hardcoding it worked on the
 *   machine it was written on and left a coloured seam everywhere else: the
 *   header carries the safe-area inset, so it is 89px on a plain viewport and
 *   taller on any phone with a notch.
 *
 * Both are cleared on unmount, so a screen without a band keeps its ordinary
 * dark header.
 */
export function useBrandBand(): void {
  useEffect(() => {
    document.body.dataset.band = "";

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
  }, []);
}
