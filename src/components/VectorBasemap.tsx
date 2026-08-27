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
          attribution:
            '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; OpenMapTiles &copy; OpenStreetMap contributors',
        });
        layer.addTo(map);

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
