import L from "leaflet";
import { useMemo } from "react";
import { Marker, Tooltip } from "react-leaflet";
import type { LatLng } from "./geo";

/**
 * The rider: a dot with an arrow pointing the way they are going, like every
 * ride-hailing map. Without a heading yet, a plain dot with a pulse.
 */
export function HeadingMarker({ at, heading, colour = "#16a34a", label, permanent = false, size = 34 }: {
  at: LatLng;
  heading: number | null;
  colour?: string;
  label?: string;
  permanent?: boolean;
  size?: number;
}) {
  const icon = useMemo(() => L.divIcon({
    className: "gg-heading",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span class="gg-heading-pulse" style="background:${colour}"></span>`
      + (heading != null
        ? `<svg viewBox="0 0 40 40" width="${size}" height="${size}" style="transform:rotate(${Math.round(heading)}deg)"><circle cx="20" cy="20" r="11" fill="${colour}" stroke="#fff" stroke-width="3"/><path d="M20 3 L27 14 L20 11 L13 14 Z" fill="${colour}" stroke="#fff" stroke-width="1.5"/></svg>`
        : `<svg viewBox="0 0 40 40" width="${size}" height="${size}"><circle cx="20" cy="20" r="11" fill="${colour}" stroke="#fff" stroke-width="3"/></svg>`),
  }), [heading == null ? null : Math.round(heading / 5), colour, size]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Marker position={[at.lat, at.lng]} icon={icon} interactive={Boolean(label)} keyboard={false}>
      {label ? <Tooltip direction="top" offset={[0, -size / 2]} permanent={permanent}>{label}</Tooltip> : null}
    </Marker>
  );
}
