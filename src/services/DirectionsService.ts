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
}

/**
 * Route between two points. Returns null rather than throwing — no directions
 * is a state the map can show; an exception in a render is not.
 */
export async function directionsBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<Directions | null> {
  const coords = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `${OSRM}${coords}?overview=full&geometries=geojson&steps=true&alternatives=false`,
      { signal: controller.signal },
    );
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.code !== "Ok" || !body.routes?.length) return null;

    const route = body.routes[0];
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
