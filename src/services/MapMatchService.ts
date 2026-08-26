/**
 * Snap a recorded GPS trace onto the road network.
 *
 * A phone's raw positions do not sit on roads. They drift by tens of metres in
 * traffic, jump between buildings, and cut the corner at every junction — so a
 * line drawn straight through them looks like the driver went through the shops
 * rather than around them. Tracking apps do not draw the points; they draw the
 * roads the points imply. That is map matching, and this is the thin client for
 * it.
 *
 * OSRM's public server does the matching. It needs no key and costs nothing,
 * which is the right trade for a platform that stays free for drivers — but it
 * is a shared demo service with no uptime promise, so **every failure here is
 * non-fatal**. If the network is gone, the server is busy, or the trace cannot
 * be matched to any road, the caller gets the original points back and draws the
 * honest straight line. A worse-looking route is a far smaller problem than a
 * map that shows nothing.
 *
 * Nothing personal is sent beyond the coordinates themselves — no user id, no
 * app, no timestamps.
 */

import type { LocationPoint } from "../types";

const OSRM = "https://router.project-osrm.org/match/v1/driving/";

/**
 * Ten. Measured against the live server on 2026-08-26, not guessed: eleven
 * coordinates already returns `TooBig — Too many trace coordinates`. This was
 * written as 90 first, which meant every real trace was rejected and every path
 * silently fell back to a straight line.
 */
const MAX_POINTS_PER_REQUEST = 10;

/** One shared point between chunks, so the seam is matched rather than guessed. */
const CHUNK_OVERLAP = 1;

/** A slow answer is worse than no answer: the map should not sit empty waiting. */
const TIMEOUT_MS = 8000;

/**
 * How far apart the points sent to the matcher should be.
 *
 * Deliberately coarse. Matching does not need dense input — it reconstructs the
 * road geometry *between* the points it is given, so a fix every 130 metres
 * still comes back following every curve and corner in between. What density
 * does cost is requests: at ten coordinates each, a 25 km shift thinned to 12 m
 * would be two thousand points and two hundred requests against a free shared
 * service. At 130 m it is under two hundred points and around twenty.
 */
const MIN_SPACING_M = 130;

/**
 * Hard ceiling on requests for one path. Past this the trace is left as a plain
 * line rather than hammering a public server nobody is paying for — a slightly
 * rougher route is a fair price for not being the reason the service gets shut
 * to everyone.
 */
const MAX_REQUESTS = 24;

/** Gap between requests. Sequential and paced, not twenty at once. */
const REQUEST_SPACING_MS = 120;

/** Above this the fix is a guess, and feeding guesses to a matcher moves the road. */
const WORST_ACCURACY_M = 60;

export type MatchedPath = {
  /** Road-following geometry when matching worked, the input otherwise. */
  positions: [number, number][];
  /** False when this is the raw trace, so the UI can say so rather than imply precision. */
  snapped: boolean;
};

const metresBetween = (a: LocationPoint, b: LocationPoint) => {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/**
 * Drop fixes that are too inaccurate to trust and too close together to matter.
 * Done before anything is sent, because it is also the only step that still
 * helps when the network is gone.
 */
export function thin(points: LocationPoint[]): LocationPoint[] {
  const out: LocationPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (typeof p.accuracy === "number" && p.accuracy > WORST_ACCURACY_M) continue;
    const last = out[out.length - 1];
    if (last && metresBetween(last, p) < MIN_SPACING_M) continue;
    out.push(p);
  }
  return out;
}

/** Split into overlapping chunks OSRM will accept. */
function chunk<T>(items: T[], size: number, overlap: number): T[][] {
  if (items.length <= size) return [items];
  const chunks: T[][] = [];
  let start = 0;
  while (start < items.length) {
    chunks.push(items.slice(start, start + size));
    if (start + size >= items.length) break;
    start += size - overlap;
  }
  return chunks;
}

async function matchChunk(points: LocationPoint[]): Promise<[number, number][] | null> {
  const coords = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  // `radiuses` tells OSRM how far it may look for a road under each fix. Without
  // it a single bad point makes the whole trace unmatchable and the request
  // returns NoMatch for a route that is 99% fine.
  const radiuses = points
    .map((p) => Math.min(50, Math.max(10, Math.round(p.accuracy ?? 20))))
    .join(";");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${OSRM}${coords}?geometries=geojson&overview=full&radiuses=${radiuses}&tidy=true`,
      { signal: controller.signal },
    );
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.code !== "Ok" || !Array.isArray(body.matchings)) return null;

    const out: [number, number][] = [];
    for (const m of body.matchings) {
      // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
      for (const [lng, lat] of m?.geometry?.coordinates ?? []) out.push([lat, lng]);
    }
    return out.length ? out : null;
  } catch {
    // Offline, aborted, blocked, malformed — all the same answer to the caller.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Snap a trace to roads, falling back to the raw line whenever that is not
 * possible. Never throws.
 */
export async function snapToRoads(points: LocationPoint[]): Promise<MatchedPath> {
  const cleaned = thin(points);
  const raw = cleaned.map((p) => [p.lat, p.lng] as [number, number]);

  // Two points is a straight line whatever the road does, and one is not a path.
  if (cleaned.length < 3) return { positions: raw, snapped: false };

  const pieces = chunk(cleaned, MAX_POINTS_PER_REQUEST, CHUNK_OVERLAP);
  if (pieces.length > MAX_REQUESTS) return { positions: raw, snapped: false };

  // Sequential and paced. Firing twenty parallel requests at a free service is
  // how a free service stops being available, and the browser starts refusing
  // its own connections long before the server does.
  const results: ([number, number][] | null)[] = [];
  for (const piece of pieces) {
    results.push(await matchChunk(piece));
    if (results[results.length - 1] === null) break;   // give up early, do not keep asking
    if (pieces.length > 1) await new Promise((r) => setTimeout(r, REQUEST_SPACING_MS));
  }

  // Partial success is still worse than useless: half a snapped route joined to
  // half a raw one has a visible seam and implies a precision it does not have.
  if (results.some((r) => r === null)) return { positions: raw, snapped: false };

  const joined: [number, number][] = [];
  for (const piece of results) {
    for (const c of piece as [number, number][]) {
      const last = joined[joined.length - 1];
      if (last && last[0] === c[0] && last[1] === c[1]) continue;  // seam duplicate
      joined.push(c);
    }
  }
  return joined.length > 1 ? { positions: joined, snapped: true } : { positions: raw, snapped: false };
}
