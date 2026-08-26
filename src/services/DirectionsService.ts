/**
 * Turn-by-turn directions from where the driver is to somewhere they picked.
 *
 * The map could already search for a place and drop a pin on it, and then did
 * nothing with it — which is the difference a driver notices between this and
 * the map already on their phone. OSRM answers with the road geometry, the
 * distance, the duration and named manoeuvres, for free and without a key, from
 * the same public server the route matcher uses.
 *
 * What this deliberately is not: live navigation. There is no traffic in these
 * timings and no rerouting when a turn is missed, and pretending otherwise
 * would be the dangerous kind of wrong — a driver trusting an ETA that has
 * never seen a traffic jam. The duration is free-flow, and the UI says so.
 */

const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const TIMEOUT_MS = 9000;

export interface DirectionStep {
  /** "turn", "depart", "arrive", "roundabout"… straight from OSRM. */
  type: string;
  /** "left", "right", "slight left"… may be absent on depart/arrive. */
  modifier?: string;
  /** Street name, when the road has one. */
  road: string;
  metres: number;
}

export interface Directions {
  positions: [number, number][];
  km: number;
  /** Free-flow minutes. No traffic model exists behind this number. */
  minutes: number;
  steps: DirectionStep[];
  /**
   * Average speed the driver has actually achieved on roads near this route,
   * from their own recorded history. Undefined when they have never driven any
   * of it — which is most routes, most of the time, and is why this is shown as
   * a bonus rather than relied on for ranking.
   */
  observedKmh?: number;
  /** How much of this route the driver has driven before, 0..1. */
  familiarity?: number;
}

/**
 * Route between two points. Returns null rather than throwing — no directions
 * is a state the map can show; an exception in a render is not.
 */
export async function directionsBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<Directions[] | null> {
  const coords = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `${OSRM}${coords}?overview=full&geometries=geojson&steps=true&alternatives=3`,
      { signal: controller.signal },
    );
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.code !== "Ok" || !body.routes?.length) return null;

    const parse = (route: any): Directions | null => {
    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
    const positions: [number, number][] = (route.geometry?.coordinates ?? []).map(
      ([lng, lat]: [number, number]) => [lat, lng] as [number, number],
    );
    if (positions.length < 2) return null;

    const steps: DirectionStep[] = (route.legs?.[0]?.steps ?? [])
      .map((s: any) => ({
        type: s?.maneuver?.type ?? "continue",
        modifier: s?.maneuver?.modifier ?? undefined,
        road: s?.name || "",
        metres: Math.round(s?.distance ?? 0),
      }))
      // OSRM emits zero-length steps at junctions; they read as noise in a list.
      .filter((s: DirectionStep, i: number, all: DirectionStep[]) =>
        s.metres > 0 || i === 0 || i === all.length - 1,
      );

      return {
        positions,
        km: Math.round((route.distance ?? 0) / 100) / 10,
        minutes: Math.max(1, Math.round((route.duration ?? 0) / 60)),
        steps,
      };
    };

    // OSRM returns the alternatives it found, which is often one and sometimes
    // three. Shortest and fastest are frequently different roads, and which one
    // a driver wants is theirs to decide, not the app's.
    const routes = body.routes.map(parse).filter(Boolean) as Directions[];
    return routes.length ? routes : null;
  } catch {
    // Offline, aborted, blocked, malformed — all the same answer to the caller.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A short human phrase for a manoeuvre, for the step list. */
export function describeStep(step: DirectionStep): string {
  const dir = step.modifier ? step.modifier.replace(/^\w/, (c) => c.toUpperCase()) : "";
  const on = step.road ? ` onto ${step.road}` : "";
  switch (step.type) {
    case "depart": return step.road ? `Start on ${step.road}` : "Start";
    case "arrive": return "Arrive";
    case "roundabout":
    case "rotary": return `Take the roundabout${on}`;
    case "merge": return `Merge${on}`;
    case "fork": return `Keep ${step.modifier ?? "ahead"}${on}`;
    case "new name": return `Continue${on}`;
    default: return dir ? `${dir}${on}` : `Continue${on}`;
  }
}

/**
 * Score each alternative against roads this driver has actually driven.
 *
 * This is the part a general-purpose map cannot do. Nobody gives away live
 * traffic — not OSRM, not anyone free — so "the route with less traffic" is not
 * available to buy. But Buzz records every driver's real position and time, so
 * the speed actually achieved on a given road is data it already owns.
 *
 * What comes back is honest about its own thinness: `familiarity` says how much
 * of the route the driver has been on before, and `observedKmh` is the average
 * they managed there. With one day of history that covers almost nothing, which
 * is why the UI shows it as a note beside a route rather than reordering the
 * list by it. Ranking routes on two data points would be worse than not
 * ranking them.
 */
export function scoreAgainstHistory(
  routes: Directions[],
  history: { lat: number; lng: number; timestamp: number }[],
  /** How close a recorded point must be to count as "on this road". */
  nearMetres = 45,
): Directions[] {
  if (history.length < 3) return routes;

  // Speed at each historical point, and a coarse spatial bucket to look it up
  // by. A full spatial index would be the right answer at city scale; at a few
  // thousand points a grid keyed to ~50 m is simpler and fast enough.
  const CELL = nearMetres / 111_320;
  const grid = new Map<string, { sum: number; n: number }>();
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1], b = history[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180, lat2 = (b.lat * Math.PI) / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    const metres = 2 * 6_371_000 * Math.asin(Math.sqrt(h));
    const secs = Math.max(1, (b.timestamp - a.timestamp) / 1000);
    const kmh = (metres / secs) * 3.6;
    // Stationary time is not a speed on a road. Without this the average
    // includes every minute spent parked at a restaurant, and a route the
    // driver knows well reports "you avg 0.4 km/h here" — which reads as the
    // road being impassable rather than as the driver having waited on it.
    // Stops are already shown as their own markers; this number is about
    // moving.
    if (!Number.isFinite(kmh) || kmh > 200 || kmh < 3) continue;
    const key = `${Math.round(b.lng / CELL)}:${Math.round(b.lat / CELL)}`;
    const cell = grid.get(key) ?? { sum: 0, n: 0 };
    cell.sum += kmh; cell.n += 1;
    grid.set(key, cell);
  }
  if (!grid.size) return routes;

  return routes.map((route) => {
    let hits = 0, sum = 0, n = 0;
    for (const [lat, lng] of route.positions) {
      const key = `${Math.round(lng / CELL)}:${Math.round(lat / CELL)}`;
      const cell = grid.get(key);
      if (!cell) continue;
      hits += 1; sum += cell.sum; n += cell.n;
    }
    if (!hits || !n) return route;
    return {
      ...route,
      familiarity: hits / route.positions.length,
      observedKmh: Math.round((sum / n) * 10) / 10,
    };
  });
}
