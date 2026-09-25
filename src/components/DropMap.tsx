import { useEffect, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { useT } from "../i18n";
import { describeStep, directionsBetween, type Directions } from "../services/DirectionsService";
import { LocationService } from "../services/LocationService";

const TILE_URL = (import.meta.env.VITE_TILE_URL as string) || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
/** Re-route once the worker is this far from where the last route started. */
const REROUTE_METRES = 250;

interface Point {
  lat: number;
  lng: number;
}

function metresBetween(a: Point, b: Point) {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Frame the whole route once, and again only when a new route arrives. */
function Fit({ route, here, to }: { route: Directions | null; here: Point | null; to: Point }) {
  const map = useMap();
  useEffect(() => {
    if (route) map.fitBounds(route.positions, { padding: [24, 24], maxZoom: 17 });
    else if (here) map.fitBounds([[here.lat, here.lng], [to.lat, to.lng]], { padding: [28, 28], maxZoom: 16 });
    else map.setView([to.lat, to.lng], 15);
  }, [map, route, here === null]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * Where the delivery goes, once the pickup code is in: the road route from the
 * worker to the customer's pin, drawn on the card, with the distance, the time
 * and the next turns. It re-routes as the worker moves. Navigate hands the same
 * pin to the phone's maps app for voice turn-by-turn.
 *
 * `start` stands in for GPS in the dev preview only; the app never passes it.
 */
export function DropMap({ to, start }: { to: Point; start?: Point }) {
  const t = useT();
  const [here, setHere] = useState<Point | null>(start ?? null);
  const [route, setRoute] = useState<Directions | null>(null);
  const [routing, setRouting] = useState(false);
  const routedFrom = useRef<Point | null>(null);

  // The worker's position, every 10 seconds while the card is open.
  useEffect(() => {
    if (start) return;
    let live = true;
    const tick = () =>
      void LocationService.currentPosition()
        .then((p) => live && setHere({ lat: p.lat, lng: p.lng }))
        .catch(() => undefined);
    tick();
    const timer = window.setInterval(tick, 10000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The road route: fetched on the first fix, then again when they have moved on.
  // A small GPS wobble must not throw away a route still loading, so only the
  // newest request's answer is kept and nothing is cancelled until the card closes.
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  useEffect(() => {
    if (!here) return;
    if (routedFrom.current && metresBetween(routedFrom.current, here) < REROUTE_METRES) return;
    routedFrom.current = here;
    const id = ++request.current;
    setRouting(true);
    void directionsBetween(here, to).then((found) => {
      if (!mounted.current || request.current !== id) return;
      setRoute(found?.[0] ?? null);
      setRouting(false);
    });
  }, [here, to.lat, to.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextTurns = route ? route.steps.filter((s) => s.type !== "depart").slice(0, 3) : [];

  return (
    <div className="drop-route">
      <div className="drop-map">
        <MapContainer center={[to.lat, to.lng]} zoom={15} attributionControl={false} zoomControl={false} style={{ height: "100%" }}>
          <TileLayer url={TILE_URL} />
          <Fit route={route} here={here} to={to} />
          {route ? (
            <>
              <Polyline positions={route.positions} pathOptions={{ color: "#312e81", weight: 9, opacity: 0.25 }} />
              <Polyline positions={route.positions} pathOptions={{ color: "#4F46E5", weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round" }} />
            </>
          ) : here ? (
            <Polyline positions={[[here.lat, here.lng], [to.lat, to.lng]]} pathOptions={{ color: "#4F46E5", weight: 3, dashArray: "6 8" }} />
          ) : null}
          {here ? <CircleMarker center={[here.lat, here.lng]} radius={8} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#111827", fillOpacity: 1 }} /> : null}
          <CircleMarker center={[to.lat, to.lng]} radius={11} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#4F46E5", fillOpacity: 1 }} />
        </MapContainer>
      </div>
      <p className="drop-meta">
        {route ? (
          <><b>{t("job_routeTo", { km: String(route.km), min: String(route.minutes) })}</b> <em>{t("job_routeNoTraffic")}</em></>
        ) : routing ? t("job_routeFinding")
          : here ? t("job_routeNone")
          : t("job_routeNeedsLocation")}
      </p>
      {nextTurns.length ? (
        <ol className="drop-steps">
          {nextTurns.map((step, i) => (
            <li key={i}>
              <span>{describeStep(step)}</span>
              <small>{step.metres >= 1000 ? `${(step.metres / 1000).toFixed(1)} km` : `${step.metres} m`}</small>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
