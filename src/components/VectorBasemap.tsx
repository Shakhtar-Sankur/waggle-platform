import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import "@maplibre/maplibre-gl-leaflet";
import L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * A vector basemap, underneath the Leaflet layers the app already draws.
 *
 * The map was raster tiles — a PNG per square, per zoom. That is why it looked
 * a decade old: labels are painted into the image so they cannot rotate or
 * resize, every zoom step is a fresh download rather than a glide, and the
 * whole thing is somebody else's design decisions baked into pixels. Every
 * current maps app — Google, Apple, Uber — renders vectors on the GPU instead.
 *
 * This swaps ONLY the basemap. maplibre-gl-leaflet puts a MapLibre canvas in a
 * Leaflet layer, so the recorded path, the driver markers, the ETA bubbles and
 * the controls are untouched code that keeps working on top.
 *
 * Tiles come from OpenFreeMap: genuinely free, no API key, no rate limit, and
 * self-hostable from a single planet file if the traffic ever justifies it.
 * That last part matters more than it sounds — the alternatives all bill per
 * request, and this app's users are drivers who leave the map open for a
 * whole shift.
 *
 * Why not CARTO, which is the obvious modern-looking swap: it stamps
 * "API KEY REQUIRED · carto.com/basemaps/apikey" into a SAMPLE of its tiles
 * when unkeyed. Not an error and not a rate limit — a working map with an
 * advert printed across parts of it. This app shipped that once already, and a
 * spot-check of a handful of tiles does not catch it, because most tiles come
 * back clean.
 *
 * Overridable with VITE_MAP_STYLE for a build that has bought a provider.
 */
const STYLE_URL =
  (import.meta.env.VITE_MAP_STYLE as string) || "https://tiles.openfreemap.org/styles/liberty";

export function VectorBasemap({ dark = false }: { dark?: boolean }) {
  const map = useMap();

  useEffect(() => {
    // `any` because the plugin extends L at runtime and ships no types for it.
    const layer = (L as any).maplibreGL({
      style: STYLE_URL,
      // The plugin needs the library handed to it explicitly under Vite, which
      // does not put maplibregl on window the way a script tag would.
      maplibreGL: maplibregl,
      attribution:
        '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; OpenMapTiles &copy; OpenStreetMap contributors',
    });

    layer.addTo(map);

    // Keep the basemap beneath everything Leaflet draws. Without this the
    // canvas sits in whatever pane it landed in and can cover the route.
    const container = layer.getContainer?.();
    if (container) container.style.zIndex = "0";

    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  // Dark mode is applied to the canvas rather than by loading a second style:
  // a whole extra style download to inverse a basemap is not worth the bytes
  // on a driver's connection, and the filter reads correctly because the
  // basemap is the only thing in this layer.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".leaflet-maplibre-layer");
    if (el) el.style.filter = dark ? "invert(1) hue-rotate(180deg) brightness(.92)" : "";
  }, [dark]);

  return null;
}
