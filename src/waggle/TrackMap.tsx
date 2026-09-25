import { useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Tooltip, useMap } from "react-leaflet";
import { VectorBasemap } from "../components/VectorBasemap";
import { HeadingMarker } from "../maps/HeadingMarker";
import { snapToRoute, splitRoute } from "../maps/geo";
import { useSmoothPoint } from "../maps/useSmoothPoint";
import { directionsBetween, type Directions } from "../services/DirectionsService";

interface Point {
  lat: number;
  lng: number;
}

/** Off the route by more than this: the rider took another road, so route again from them. */
const OFF_ROUTE_M = 80;

function Fit({ points }: { points: Point[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join("|");
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 16 });
    else if (points[0]) map.setView([points[0].lat, points[0].lng], 15);
  }, [map, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * The customer's map: the shop, their door, and the road between them; once the
 * rider has the order, the rider gliding along that road with an arrow for the
 * way they are going, the road already ridden fading out, and the time left
 * counting down from the distance still to go. It routes again only when the
 * rider leaves the road it drew, not on every position.
 */
export function TrackMap({
  shop,
  drop,
  rider,
  labels,
  onRoute,
}: {
  shop: Point;
  drop: Point;
  rider: Point | null;
  labels: { shop: string; drop: string; rider: string };
  /** Time and distance left, whenever they change. */
  onRoute?: (route: { minutes: number; km: number; traffic: boolean } | null) => void;
}) {
  const [route, setRoute] = useState<Directions | null>(null);
  const routedFor = useRef<string>("");
  // Positions arrive every 8 s; glide between them for most of that.
  const { point: smooth, heading } = useSmoothPoint(rider, 7000);
  const from = rider ?? shop;

  const split = useMemo(() => (route && smooth ? splitRoute(route.positions, smooth) : null), [route, smooth?.lat, smooth?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Route from the rider (or the shop, before pickup); again if they leave it.
  useEffect(() => {
    const leg = rider ? "rider" : "shop";
    const off = route && rider ? splitRoute(route.positions, rider).offMetres : 0;
    // Same leg, still on its road: keep it. No road yet (the last request failed): ask again.
    if (routedFor.current === leg && route && off < OFF_ROUTE_M) return;
    routedFor.current = leg;
    let live = true;
    void directionsBetween(from, drop).then((found) => {
      if (live) setRoute(found?.[0] ?? null);
    });
    return () => { live = false; };
  }, [from.lat, from.lng, drop.lat, drop.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Time left: the share of the route still to ride, at the route's own pace.
  const left = route ? (split ? split.leftMetres / 1000 : route.km) : null;
  const minutes = route && left != null ? Math.max(1, Math.round((left / Math.max(route.km, 0.1)) * route.minutes)) : null;
  useEffect(() => {
    onRoute?.(route && left != null && minutes != null ? { minutes, km: Math.round(left * 10) / 10, traffic: Boolean(route.traffic) } : null);
  }, [minutes, route]); // eslint-disable-line react-hooks/exhaustive-deps

  const points = [from, drop];
  // The rider drawn on the road while they are on it, pointing along it.
  const onRoad = snapToRoute(route?.positions, smooth);

  return (
    <div className="wg-map">
      <MapContainer center={[drop.lat, drop.lng]} zoom={14} attributionControl={false} zoomControl={false} scrollWheelZoom={false} style={{ height: "100%" }}>
        <VectorBasemap />
        <Fit points={points} />
        {route ? (
          <>
            {rider && split?.done.length ? <Polyline positions={split.done} pathOptions={{ color: "#9ca3af", weight: 4, opacity: 0.7, dashArray: "2 8", lineCap: "round" }} /> : null}
            <Polyline positions={rider && split ? split.left : route.positions} pathOptions={{ color: "#312e81", weight: 9, opacity: 0.2 }} />
            <Polyline positions={rider && split ? split.left : route.positions} pathOptions={{ color: "#4F46E5", weight: 5, lineCap: "round", lineJoin: "round" }} />
          </>
        ) : (
          <Polyline positions={points.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: "#4F46E5", weight: 3, dashArray: "6 8" }} />
        )}
        <CircleMarker center={[shop.lat, shop.lng]} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#0f172a", fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -8]}>{labels.shop}</Tooltip>
        </CircleMarker>
        <CircleMarker center={[drop.lat, drop.lng]} radius={11} pathOptions={{ color: "#fff", weight: 3, fillColor: "#4F46E5", fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -10]}>{labels.drop}</Tooltip>
        </CircleMarker>
        {onRoad.point ? <HeadingMarker at={onRoad.point} heading={onRoad.heading ?? heading} colour="#16a34a" label={labels.rider} permanent /> : null}
      </MapContainer>
    </div>
  );
}
