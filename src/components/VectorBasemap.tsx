import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import L from "leaflet";
import { useEffect, useState } from "react";
import { TileLayer, useMap } from "react-leaflet";

/**
 * A vector basemap, underneath the Leaflet layers the app already draws.
 *
 * The map was raster tiles — a PNG per square, per zoom. That is why it looked
 * a decade old: labels are painted into the image so they cannot rotate, curve
 * or resize, every zoom step is a fresh download rather than a glide, and the
 * design is somebody else's decisions baked into pixels. Google, Apple and Uber
 * all render vectors on the GPU.
 *
 * This swaps ONLY the basemap. maplibre-gl-leaflet puts a MapLibre canvas in a
 * Leaflet layer, so the recorded path, driver markers, ETA bubbles and controls
 * are untouched code drawing on top.
 *
 * Tiles come from OpenFreeMap: free, no API key, no rate limit, and self-
 * hostable from one planet file. That last part is why it beats the
 * alternatives here — they bill per request, and these users are drivers who
 * leave the map open for a whole shift.
 *
 * Not CARTO, which is the obvious modern-looking swap and which this app
 * shipped once already: unkeyed, it stamps "API KEY REQUIRED" into a SAMPLE of
 * its tiles. Most come back clean, which is exactly how it gets through review.
 */
const STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE as string) || "https://tiles.openfreemap.org/styles/liberty";

/** The raster map this falls back to. Dated, but a map. */
const FALLBACK_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export function VectorBasemap({ dark = false }: { dark?: boolean }) {
  const map = useMap();
  /** Set if the vector layer cannot be created, so the map is never blank. */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let layer: L.Layer | null = null;
    let cancelled = false;
    /** Handles for the two re-measure nudges below, so unmount cancels them. */
    let frame = 0;
    let settle = 0;

    (async () => {
      try {
        // The plugin is a UMD bundle that extends whatever `L` it finds on the
        // global. Under Vite there is no global `L` at all, so it attached to
        // its own copy and `L.maplibreGL` was undefined on the instance this
        // file imported — the map rendered blank and the screen threw.
        //
        // So: publish L, THEN import the plugin, and only then use it. The
        // import has to be dynamic for that order to hold — a static one is
        // hoisted above this assignment and the bug comes straight back.
        (window as unknown as { L: typeof L }).L = L;
        await import("@maplibre/maplibre-gl-leaflet");
        if (cancelled) return;

        const factory = (L as unknown as { maplibreGL?: (o: unknown) => L.Layer }).maplibreGL;
        if (typeof factory !== "function") throw new Error("maplibre-gl-leaflet did not attach");

        layer = factory({
          style: STYLE_URL,
          // Handed over explicitly: the plugin looks for maplibregl on the
          // global too, and it is not there under a bundler either.
          maplibreGL: maplibregl,
          // No `attribution` here on purpose. The layer's own option and the
          // control added below both feed the same box, and the credit came
          // out twice — "© OpenFreeMap © OpenMapTiles © OpenStreetMap,
          // OpenFreeMap © OpenMapTiles Data from OpenStreetMap". One source.
        });
        layer.addTo(map);

        // Nudge both maps to re-measure.
        //
        // MapLibre fixes its viewport when the layer is added, and on this
        // screen that happens BEFORE the layout settles — the header band, the
        // bottom sheet and the web fonts all land after. So the GL map keeps a
        // stale size and paints NOTHING: the canvas is present, correctly
        // positioned and completely blank.
        //
        // Seen in the running app rather than reasoned about. The basemap was
        // empty on first mount, no error logged, the raster fallback never
        // fired because nothing had thrown — and dispatching a single resize
        // event drew the whole city instantly. A driver opening Routes would
        // have got a blank map until they rotated the phone.
        //
        // Two nudges, because one is not enough to cover both cases: the next
        // frame catches the ordinary layout pass, and a short timeout catches
        // the late one when fonts or the sheet animate in. Both are cheap, and
        // resizing to the size it already has is a no-op.
        const nudge = () => {
          // invalidateSize() alone does NOT work here, and the reason is worth
          // recording: Leaflet only emits `resize` when the measured size has
          // actually CHANGED. The container's box is correct from the start —
          // it is MapLibre's own viewport that is stale — so invalidateSize
          // measures the same numbers, decides nothing happened, and stays
          // silent. The plugin listens for that event, so it never resizes,
          // and the map stays blank. Tried it; nothing moved.
          //
          // Firing the event directly is what the plugin is actually waiting
          // for. Same-size payload on purpose: the point is the notification,
          // not the numbers.
          map.invalidateSize({ animate: false });
          const size = map.getSize();
          map.fire("resize", { oldSize: size, newSize: size });
        };
        frame = requestAnimationFrame(nudge);
        settle = window.setTimeout(nudge, 350);

        // The attribution control is off on the MapContainer so Leaflet does
        // not stamp its own name in front. The DATA credit is still required —
        // ODbL for OpenStreetMap, and OpenMapTiles' own terms — so it is added
        // back here on its own, without the prefix.
        L.control
          .attribution({ position: "bottomright", prefix: false })
          .addAttribution(
            '&copy; <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; OpenMapTiles &copy; OpenStreetMap',
          )
          .addTo(map);

        // Keep the basemap beneath everything Leaflet draws, so the route is
        // never hidden by the canvas.
        const container = (layer as unknown as { getContainer?: () => HTMLElement }).getContainer?.();
        if (container) container.style.zIndex = "0";
      } catch (error) {
        // A blank map is worse than a dated one. Fall back to raster rather
        // than leaving the driver with nothing to navigate by.
        console.warn("Vector basemap unavailable, falling back to raster:", error);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      // A nudge that fires after unmount would call resize() on a map that is
      // gone, which throws inside MapLibre rather than failing quietly.
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
      if (layer) map.removeLayer(layer);
    };
  }, [map]);

  // Dark mode filters the canvas rather than loading a second style: a whole
  // extra style download to invert a basemap is not worth the bytes on a
  // driver's connection.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".leaflet-maplibre-layer");
    if (el) el.style.filter = dark ? "invert(1) hue-rotate(180deg) brightness(.92)" : "";
  }, [dark, failed]);

  if (failed) {
    return <TileLayer url={FALLBACK_TILES} attribution="&copy; OpenStreetMap contributors" />;
  }
  return null;
}
