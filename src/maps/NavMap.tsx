import { CornerUpLeft, CornerUpRight, Crosshair, MoveUp, RotateCw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Tooltip, useMap } from "react-leaflet";
import { VectorBasemap } from "../components/VectorBasemap";
import { useLangStore, useT } from "../i18n";
import { describeStep, directionsBetween, type DirectionStep, type Directions } from "../services/DirectionsService";
import { LocationService } from "../services/LocationService";
import { useLocationStore } from "../stores/useLocationStore";
import { metres, metresAlong, snapToRoute, splitRoute, type LatLng } from "./geo";
import { HeadingMarker } from "./HeadingMarker";
import { useSmoothPoint } from "./useSmoothPoint";
import { speak, stopSpeaking } from "./voice";

/** Off the route by more than this, twice in a row: find a new route from here. */
const OFF_ROUTE_M = 60;
const VOICE_KEY = "gg_voice";

const readVoice = () => { try { return localStorage.getItem(VOICE_KEY) !== "off"; } catch { return true; } };

function turnIcon(step: DirectionStep | null) {
  const m = step?.modifier ?? "";
  if (/left/.test(m)) return <CornerUpLeft size={26} />;
  if (/right/.test(m)) return <CornerUpRight size={26} />;
  if (step?.type === "roundabout" || step?.type === "rotary") return <RotateCw size={26} />;
  return <MoveUp size={26} />;
}

function Follow({ at, follow }: { at: LatLng | null; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (follow && at) map.setView([at.lat, at.lng], Math.max(map.getZoom(), 16), { animate: true });
  }, [at?.lat, at?.lng, follow]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function FitOnce({ route, here, to }: { route: Directions | null; here: LatLng | null; to: LatLng }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    if (route) { map.fitBounds(route.positions, { padding: [30, 30], maxZoom: 17 }); done.current = true; }
    else if (here) map.fitBounds([[here.lat, here.lng], [to.lat, to.lng]], { padding: [30, 30], maxZoom: 16 });
    else map.setView([to.lat, to.lng], 15);
  }, [route, here === null]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * The rider's navigation, inside the job card: the road route to the shop or
 * the customer, route choices, the part already driven greyed out, an arrow
 * that points the way the rider is going, the next turn in large type and
 * spoken aloud, and a new route the moment they leave this one. The ETA counts
 * down from the distance actually left, not from when the route was fetched.
 *
 * Positions come from the GPS that runs while the rider is online; `start`
 * stands in for it in the dev preview only.
 */
export function NavMap({ to, toLabel, start }: { to: LatLng; toLabel: string; start?: LatLng }) {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const tracked = useLocationStore((s) => s.currentLocation);
  const tracking = useLocationStore((s) => s.isTracking);
  const [polled, setPolled] = useState<LatLng | null>(start ?? null);
  const raw: LatLng | null = start ?? (tracking && !tracked.fallback ? { lat: tracked.lat, lng: tracked.lng } : polled);
  const { point: here, heading } = useSmoothPoint(raw, 1200);

  const [routes, setRoutes] = useState<Directions[] | null>(null);
  const [chosen, setChosen] = useState(0);
  const [routing, setRouting] = useState(false);
  const [voice, setVoice] = useState(readVoice);
  const [follow, setFollow] = useState(true);
  const stopFollow = useCallback(() => setFollow(false), []);
  const offCount = useRef(0);
  const lastRoute = useRef(0);
  /** Where the current route was asked from. */
  const routedFrom = useRef<LatLng | null>(null);
  const request = useRef(0);
  const spoken = useRef(new Set<string>());

  // Without the online GPS (a preview, or tracking refused), ask for a fix every 10 s.
  useEffect(() => {
    if (start || tracking) return;
    let live = true;
    const tick = () => void LocationService.currentPosition().then((p) => live && !p.fallback && setPolled({ lat: p.lat, lng: p.lng })).catch(() => undefined);
    tick();
    const timer = window.setInterval(tick, 10000);
    return () => { live = false; window.clearInterval(timer); };
  }, [start, tracking]);

  function fetchRoute(from: LatLng) {
    const id = ++request.current;
    lastRoute.current = Date.now();
    routedFrom.current = from;
    setRouting(true);
    void directionsBetween(from, to).then((found) => {
      if (request.current !== id) return;
      setRouting(false);
      if (!found) return;
      setRoutes(found);
      setChosen(0);
      spoken.current.clear();
      offCount.current = 0;
      if (voice) void speak(t("nav_sayStart", { km: String(found[0].km), min: String(found[0].minutes), to: toLabel }), lang);
    });
  }

  // The first route, as soon as there is a position.
  useEffect(() => {
    if (raw && !routes && !routing) fetchRoute(raw);
  }, [raw === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const route = routes?.[chosen] ?? null;
  const split = useMemo(() => (route && here ? splitRoute(route.positions, here) : null), [route, here?.lat, here?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Off the route: a new one, but not more than every 20 s.
  useEffect(() => {
    if (!route || !raw) return;
    const s = splitRoute(route.positions, raw);
    // Off the road where the route begins (a campus, a car park) is not leaving the
    // route: only count it once the rider has moved on from where it was asked.
    const moved = routedFrom.current ? metres(routedFrom.current, raw) : Infinity;
    offCount.current = s.offMetres > OFF_ROUTE_M && moved > 50 ? offCount.current + 1 : 0;
    if (offCount.current >= 2 && Date.now() - lastRoute.current > 20000) {
      if (voice) void speak(t("nav_sayReroute"), lang);
      fetchRoute(raw);
    }
  }, [raw?.lat, raw?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // The next turn ahead of the rider, and how far it is.
  const next = useMemo(() => {
    if (!route || !here) return null;
    const along = metresAlong(route.positions, here);
    for (const step of route.steps) {
      if (!step.at || step.type === "depart") continue;
      const at = metresAlong(route.positions, { lat: step.at[0], lng: step.at[1] });
      if (at > along + 8) return { step, inMetres: Math.round(at - along) };
    }
    return null;
  }, [route, here?.lat, here?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Say the next turn at 200 m and again just before it.
  useEffect(() => {
    if (!voice || !next) return;
    const key = `${next.step.at?.join(",")}`;
    const phrase = next.step.type === "arrive" ? t("nav_sayArrive", { to: toLabel }) : describeStep(next.step);
    if (next.inMetres <= 40 && !spoken.current.has(`${key}:now`)) {
      spoken.current.add(`${key}:now`);
      void speak(phrase, lang);
    } else if (next.inMetres <= 220 && next.inMetres > 60 && !spoken.current.has(`${key}:soon`)) {
      spoken.current.add(`${key}:soon`);
      void speak(t("nav_sayIn", { m: String(Math.round(next.inMetres / 10) * 10), what: phrase }), lang);
    }
  }, [next?.inMetres, voice]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopSpeaking(), []);

  // Drawn on the road while the rider is on it, pointing along it.
  const onRoad = snapToRoute(route?.positions, here);
  const shown = onRoad.point;
  const shownHeading = onRoad.heading ?? heading;
  const leftKm = split ? split.leftMetres / 1000 : route?.km ?? 0;
  const minutesLeft = route ? Math.max(1, Math.round((leftKm / Math.max(route.km, 0.1)) * route.minutes)) : null;
  const eta = minutesLeft != null ? new Date(Date.now() + minutesLeft * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  const arrived = here ? metres(here, to) < 40 : false;

  function toggleVoice() {
    const v = !voice;
    setVoice(v);
    try { localStorage.setItem(VOICE_KEY, v ? "on" : "off"); } catch { /* not remembered */ }
    if (!v) stopSpeaking();
  }

  return (
    <div className="nav">
      {route && next && !arrived ? (
        <div className="nav-turn" aria-live="polite">
          <span className="nav-turn-icon">{turnIcon(next.step)}</span>
          <span className="nav-turn-text">
            <b>{next.inMetres >= 1000 ? `${(next.inMetres / 1000).toFixed(1)} km` : `${Math.round(next.inMetres / 10) * 10} m`}</b>
            <small>{next.step.type === "arrive" ? t("nav_arriveAt", { to: toLabel }) : describeStep(next.step)}</small>
          </span>
          <button type="button" className="nav-voice" onClick={toggleVoice} aria-pressed={voice} aria-label={t(voice ? "nav_voiceOff" : "nav_voiceOn")}>
            {voice ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
        </div>
      ) : arrived ? (
        <div className="nav-turn is-arrived"><b>{t("nav_arrived", { to: toLabel })}</b></div>
      ) : null}

      <div className="nav-map">
        <MapContainer center={[to.lat, to.lng]} zoom={15} attributionControl={false} zoomControl={false} scrollWheelZoom={false} style={{ height: "100%" }}>
          <VectorBasemap />
          <FitOnce route={route} here={here} to={to} />
          <Follow at={shown} follow={follow && Boolean(route)} />
          <DragStopsFollow onDrag={stopFollow} />
          {(routes ?? []).map((r, i) => (i === chosen ? null : (
            <Polyline key={i} positions={r.positions} pathOptions={{ color: "#94a3b8", weight: 6, opacity: 0.7 }} eventHandlers={{ click: () => setChosen(i) }}>
              <Tooltip sticky>{t("nav_altRoute", { km: String(r.km), min: String(r.minutes) })}</Tooltip>
            </Polyline>
          )))}
          {route ? (
            <>
              {split?.done.length ? <Polyline positions={split.done} pathOptions={{ color: "#9ca3af", weight: 5, opacity: 0.8, dashArray: "2 8", lineCap: "round" }} /> : null}
              <Polyline positions={split?.left ?? route.positions} pathOptions={{ color: "#312e81", weight: 10, opacity: 0.22 }} />
              <Polyline positions={split?.left ?? route.positions} pathOptions={{ color: "#4F46E5", weight: 6, opacity: 1, lineCap: "round", lineJoin: "round" }} />
            </>
          ) : here ? (
            <Polyline positions={[[here.lat, here.lng], [to.lat, to.lng]]} pathOptions={{ color: "#4F46E5", weight: 3, dashArray: "6 8" }} />
          ) : null}
          <CircleMarker center={[to.lat, to.lng]} radius={11} pathOptions={{ color: "#fff", weight: 3, fillColor: "#4F46E5", fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -10]}>{toLabel}</Tooltip>
          </CircleMarker>
          {shown ? <HeadingMarker at={shown} heading={shownHeading} colour="#111827" /> : null}
        </MapContainer>
        {!follow && route ? (
          <button type="button" className="nav-recenter" onClick={() => setFollow(true)}><Crosshair size={16} /> {t("nav_recenter")}</button>
        ) : null}
      </div>

      <div className="nav-bottom">
        {route ? (
          <p className="nav-eta">
            <b>{minutesLeft} min</b> · {leftKm.toFixed(1)} km · {t("nav_eta", { time: eta ?? "" })}
            {!route.traffic ? <em>{t("job_routeNoTraffic")}</em> : <em className="is-live">{t("nav_liveTraffic")}</em>}
          </p>
        ) : (
          <p className="nav-eta">{routing ? t("job_routeFinding") : raw ? t("job_routeNone") : t("job_routeNeedsLocation")}</p>
        )}
        {routes && routes.length > 1 ? (
          <div className="nav-choices" role="radiogroup" aria-label={t("nav_choices")}>
            {routes.map((r, i) => (
              <button type="button" key={i} role="radio" aria-checked={chosen === i} className={chosen === i ? "is-on" : ""}
                onClick={() => { setChosen(i); spoken.current.clear(); }}>
                <b>{r.minutes} min</b><small>{r.km} km{i === 0 ? ` · ${t("nav_fastest")}` : ""}</small>
              </button>
            ))}
          </div>
        ) : null}
        {routes && !routing ? <button type="button" className="nav-refresh" onClick={() => raw && fetchRoute(raw)}>{t("nav_newRoute")}</button> : null}
      </div>
    </div>
  );
}

/** A rider who drags the map to look around should not be yanked back on the next fix. */
function DragStopsFollow({ onDrag }: { onDrag: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.on("dragstart", onDrag);
    return () => { map.off("dragstart", onDrag); };
  }, [map, onDrag]);
  return null;
}
