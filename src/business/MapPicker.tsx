import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Bhubaneswar: where Waggle starts, and the map's resting place before a pin exists. */
export const DEFAULT_CENTER: LatLng = { lat: 20.2961, lng: 85.8245 };

const TILE_URL = (import.meta.env.VITE_TILE_URL as string) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = (import.meta.env.VITE_TILE_ATTRIBUTION as string) || "&copy; OpenStreetMap contributors";

function TapToPin({ onPick }: { onPick: (point: LatLng) => void }) {
  useMapEvents({ click: (event) => onPick({ lat: event.latlng.lat, lng: event.latlng.lng }) });
  return null;
}

/** Keeps the view on the pin when it is set from outside, e.g. "use my location". */
function Follow({ point }: { point: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.setView([point.lat, point.lng], Math.max(map.getZoom(), 15));
  }, [map, point?.lat, point?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * A map you tap to drop a pin. Circle markers rather than Leaflet's image pins,
 * whose default icon paths break under Vite; a filled circle also reads better
 * on a small phone.
 *
 * `anchor` is a second, fixed point (the business, when pinning a drop-off), so
 * the person pinning can see how far the delivery goes.
 */
export function MapPicker({
  value,
  onChange,
  anchor,
  height = 240,
}: {
  value: LatLng | null;
  onChange: (point: LatLng) => void;
  anchor?: LatLng | null;
  height?: number;
}) {
  const center = value ?? anchor ?? DEFAULT_CENTER;
  return (
    <div className="biz-map" style={{ height }}>
      <MapContainer center={[center.lat, center.lng]} zoom={value || anchor ? 15 : 12} attributionControl={false} style={{ height: "100%" }}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <TapToPin onPick={onChange} />
        <Follow point={value} />
        {anchor ? (
          <CircleMarker center={[anchor.lat, anchor.lng]} radius={9} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#111827", fillOpacity: 1 }} />
        ) : null}
        {value ? (
          <CircleMarker center={[value.lat, value.lng]} radius={11} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#4F46E5", fillOpacity: 1 }} />
        ) : null}
      </MapContainer>
    </div>
  );
}
