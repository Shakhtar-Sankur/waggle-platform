/**
 * What a day's driving actually looked like, derived from points the app has
 * been recording since the beginning.
 *
 * Every route point already carries a timestamp, and the location store already
 * computes speed between fixes for its plausibility check — so the difference
 * between "a line on a map" and "a line that tells you about your shift" is
 * arithmetic, not new data collection.
 *
 * Two things come out of here:
 *
 *   - the route split into segments coloured by how fast it was covered, which
 *     is where a driver reads traffic, and
 *   - the places they stopped moving for long enough that it meant something —
 *     a wait at a restaurant, a queue, a break.
 */

import type { LocationPoint } from "../types";

const R = 6_371_000;

export function metresBetween(a: LocationPoint, b: LocationPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Standing still for at least this long is a stop worth marking, not traffic. */
const STOP_SECONDS = 180;
/** Within this radius counts as not having moved — GPS drifts while parked. */
const STOP_RADIUS_M = 28;

export interface Stop {
  lat: number;
  lng: number;
  minutes: number;
  at: number;
}

/**
 * Where the driver stopped moving for three minutes or more.
 *
 * The radius matters as much as the time: a phone sitting on a parked bike
 * still reports positions that wander twenty metres, so "did not move" has to
 * mean "stayed inside a circle", not "reported the same coordinates".
 */
export function findStops(points: LocationPoint[]): Stop[] {
  const stops: Stop[] = [];
  let anchor = 0;
  for (let i = 1; i <= points.length; i++) {
    const beyond =
      i === points.length || metresBetween(points[anchor], points[i]) > STOP_RADIUS_M;
    if (!beyond) continue;

    const last = i - 1;
    const seconds = (points[last].timestamp - points[anchor].timestamp) / 1000;
    if (last > anchor && seconds >= STOP_SECONDS) {
      stops.push({
        lat: points[anchor].lat,
        lng: points[anchor].lng,
        minutes: Math.round(seconds / 60),
        at: points[anchor].timestamp,
      });
    }
    anchor = i;
  }
  return stops;
}

export type SpeedBand = "stopped" | "slow" | "moving" | "fast";

/** Bands chosen for city delivery work, not for a motorway. */
export function bandFor(kmh: number): SpeedBand {
  if (kmh < 3) return "stopped";
  if (kmh < 15) return "slow";
  if (kmh < 35) return "moving";
  return "fast";
}

export interface SpeedSegment {
  positions: [number, number][];
  band: SpeedBand;
  kmh: number;
}

/**
 * Split a drawn path into runs of similar speed.
 *
 * The drawn path may be the road-matched geometry rather than the recorded
 * points — matching returns far more vertices than it was given, and none of
 * them carry a time. So speed is measured on the recorded points, and mapped
 * onto the drawn line by *fraction of distance travelled*: both describe the
 * same journey, so a vertex 40% of the way along the drawn line belongs to
 * whatever was happening 40% of the way along the recorded one.
 *
 * That is an approximation, and it is the honest one available — the
 * alternative is pretending the matched geometry has timestamps it does not.
 */
export function speedSegments(
  recorded: LocationPoint[],
  drawn: [number, number][],
): SpeedSegment[] {
  if (recorded.length < 2 || drawn.length < 2) return [];

  // Speed and cumulative distance along the recorded track.
  const cum: number[] = [0];
  const kmhAt: number[] = [];
  for (let i = 1; i < recorded.length; i++) {
    const m = metresBetween(recorded[i - 1], recorded[i]);
    const s = Math.max(1, (recorded[i].timestamp - recorded[i - 1].timestamp) / 1000);
    cum.push(cum[i - 1] + m);
    kmhAt.push((m / s) * 3.6);
  }
  const recordedTotal = cum[cum.length - 1];
  if (recordedTotal <= 0) return [];

  // Cumulative distance along the drawn line.
  const dCum: number[] = [0];
  for (let i = 1; i < drawn.length; i++) {
    dCum.push(
      dCum[i - 1] +
        metresBetween(
          { lat: drawn[i - 1][0], lng: drawn[i - 1][1], timestamp: 0 },
          { lat: drawn[i][0], lng: drawn[i][1], timestamp: 0 },
        ),
    );
  }
  const drawnTotal = dCum[dCum.length - 1] || 1;

  const segments: SpeedSegment[] = [];
  let current: SpeedSegment | null = null;
  let ri = 0;

  for (let i = 0; i < drawn.length; i++) {
    const target = (dCum[i] / drawnTotal) * recordedTotal;
    while (ri < kmhAt.length - 1 && cum[ri + 1] < target) ri++;
    const kmh = kmhAt[ri] ?? 0;
    const band = bandFor(kmh);

    if (!current || current.band !== band) {
      // Repeat the joining vertex so consecutive segments touch rather than
      // leaving a one-pixel gap at every colour change.
      if (current) current.positions.push(drawn[i]);
      current = { positions: [drawn[i]], band, kmh };
      segments.push(current);
    } else {
      current.positions.push(drawn[i]);
      current.kmh = kmh;
    }
  }
  return segments.filter((s) => s.positions.length > 1);
}

/** One colour per band. Red for stopped is deliberate: on a delivery map,
 *  not moving is the thing worth seeing. */
export const BAND_COLOUR: Record<SpeedBand, string> = {
  stopped: "#dc2626",
  slow: "#f59e0b",
  moving: "#fc5200",
  fast: "#16a34a",
};

/* ── where the money came from ─────────────────────────────────────────
   Earnings in this app accrue from distance genuinely travelled, so the
   distance covered inside an area IS the earnings from that area. That is
   the one thing Google's map can never show a driver: it does not know
   they were working.

   No new data. route_points has been recorded since the first release. */

export interface EarningsCell {
  lat: number;
  lng: number;
  km: number;
  earnings: number;
  /** 0..1 against the busiest cell, for colour and radius. */
  weight: number;
}

/**
 * Bucket a day's movement into a grid and total the distance in each cell.
 *
 * The cell size is in degrees of latitude, which is a constant ~111 km; the
 * longitude span is corrected by the cosine of the latitude, or cells would be
 * a third as wide in Manila as they look and twice as wide near the poles.
 */
export function earningsGrid(
  points: LocationPoint[],
  ratePerKm: number,
  cellMetres = 250,
): EarningsCell[] {
  if (points.length < 2) return [];
  const dLat = cellMetres / 111_320;
  const cells = new Map<string, { lat: number; lng: number; metres: number }>();

  for (let i = 1; i < points.length; i++) {
    const m = metresBetween(points[i - 1], points[i]);
    if (!Number.isFinite(m) || m <= 0 || m > 2000) continue;   // a jump is a bad fix, not a drive
    const p = points[i];
    const cos = Math.max(0.2, Math.cos((p.lat * Math.PI) / 180));
    const dLng = dLat / cos;
    const gy = Math.round(p.lat / dLat);
    const gx = Math.round(p.lng / dLng);
    const key = `${gx}:${gy}`;
    const cell = cells.get(key) ?? { lat: gy * dLat, lng: gx * dLng, metres: 0 };
    cell.metres += m;
    cells.set(key, cell);
  }

  const list = [...cells.values()];
  const busiest = Math.max(...list.map((c) => c.metres), 1);
  return list
    .map((c) => ({
      lat: c.lat,
      lng: c.lng,
      km: Math.round((c.metres / 1000) * 100) / 100,
      earnings: (c.metres / 1000) * ratePerKm,
      weight: c.metres / busiest,
    }))
    // A cell holding a few metres is a rounding artefact, not a place worth colouring.
    .filter((c) => c.km >= 0.05)
    .sort((a, b) => a.weight - b.weight);
}

/** Green through amber to red as a cell earns more — the usual heat ramp,
 *  with red meaning "most", not "worst". */
export function heatColour(weight: number): string {
  if (weight > 0.75) return "#dc2626";
  if (weight > 0.5) return "#f97316";
  if (weight > 0.28) return "#f59e0b";
  if (weight > 0.12) return "#84cc16";
  return "#22c55e";
}
