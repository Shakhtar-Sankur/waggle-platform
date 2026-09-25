/**
 * Route geometry for live maps: where on the route the rider is, how far is
 * left, which way they are heading. All local arithmetic, no network: the map
 * asks a routing server for the road once, and follows the rider along it
 * from then on.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function metres(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Compass bearing from a to b, 0 = north, clockwise, in degrees. */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The closest point of a polyline to p: which segment, where on it, and how far p is from the line. */
export function nearestOnRoute(route: [number, number][], p: LatLng): { index: number; point: LatLng; offMetres: number } {
  let best = { index: 0, point: { lat: route[0][0], lng: route[0][1] }, offMetres: Infinity };
  // Flat projection is fine at city scale: a few km, well under a degree.
  const kx = Math.cos(rad(p.lat));
  for (let i = 0; i < route.length - 1; i++) {
    const ax = route[i][1] * kx, ay = route[i][0];
    const bx = route[i + 1][1] * kx, by = route[i + 1][0];
    const px = p.lng * kx, py = p.lat;
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const u = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    const q = { lat: ay + u * dy, lng: (ax + u * dx) / kx };
    const d = metres(p, q);
    if (d < best.offMetres) best = { index: i, point: q, offMetres: d };
  }
  return best;
}

/**
 * Put the rider on the road. City GPS is off by 5 to 15 m and drifts into
 * buildings beside tall blocks and under flyovers; drawn raw, the rider cuts
 * across a block. Within `maxOff` metres of the route, the rider is drawn on
 * the route itself, pointing along the road. Further than that they really
 * have left it, so the true position is shown (and the route is redone).
 */
export function snapToRoute(route: [number, number][] | null | undefined, p: LatLng | null, maxOff = 35): { point: LatLng | null; heading: number | null; snapped: boolean } {
  if (!p || !route || route.length < 2) return { point: p, heading: null, snapped: false };
  const near = nearestOnRoute(route, p);
  if (near.offMetres > maxOff) return { point: p, heading: null, snapped: false };
  const a = { lat: route[near.index][0], lng: route[near.index][1] };
  const b = { lat: route[near.index + 1][0], lng: route[near.index + 1][1] };
  return { point: near.point, heading: metres(a, b) > 1 ? bearing(a, b) : null, snapped: true };
}

/** Route split at the rider: the part already driven, and the part still to go. */
export function splitRoute(route: [number, number][], p: LatLng): { done: [number, number][]; left: [number, number][]; offMetres: number; leftMetres: number } {
  if (route.length < 2) return { done: [], left: route, offMetres: 0, leftMetres: 0 };
  const near = nearestOnRoute(route, p);
  const at: [number, number] = [near.point.lat, near.point.lng];
  const done = [...route.slice(0, near.index + 1), at];
  const left = [at, ...route.slice(near.index + 1)];
  let leftMetres = 0;
  for (let i = 0; i < left.length - 1; i++) leftMetres += metres({ lat: left[i][0], lng: left[i][1] }, { lat: left[i + 1][0], lng: left[i + 1][1] });
  return { done, left, offMetres: near.offMetres, leftMetres };
}

/** Metres along the route from its start to the point nearest p. */
export function metresAlong(route: [number, number][], p: LatLng): number {
  const near = nearestOnRoute(route, p);
  let m = 0;
  for (let i = 0; i < near.index; i++) m += metres({ lat: route[i][0], lng: route[i][1] }, { lat: route[i + 1][0], lng: route[i + 1][1] });
  return m + metres({ lat: route[near.index][0], lng: route[near.index][1] }, near.point);
}
