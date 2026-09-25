import { useEffect, useRef, useState } from "react";
import { bearing, metres, type LatLng } from "./geo";

/**
 * A position that glides to each new fix instead of jumping, and the heading it
 * is moving in. Positions arrive every few seconds; drawn raw, the rider teleports
 * down the road. This eases from the old point to the new one over `ms`, the way
 * the ride-hailing apps do, and keeps the last real heading while standing still.
 */
export function useSmoothPoint(target: LatLng | null, ms = 2500): { point: LatLng | null; heading: number | null } {
  const [point, setPoint] = useState<LatLng | null>(target);
  const [heading, setHeading] = useState<number | null>(null);
  const from = useRef<LatLng | null>(target);
  const shown = useRef<LatLng | null>(target);
  const frame = useRef(0);

  useEffect(() => {
    if (!target) { setPoint(null); shown.current = null; return; }
    const start = shown.current;
    // First fix, or a jump too big to be driving (a new job, a stale fix): place it.
    if (!start || metres(start, target) > 2000) {
      shown.current = target;
      setPoint(target);
      return;
    }
    if (metres(start, target) > 3) setHeading(bearing(start, target));
    from.current = start;
    const t0 = performance.now();
    cancelAnimationFrame(frame.current);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      const p = { lat: from.current!.lat + (target.lat - from.current!.lat) * e, lng: from.current!.lng + (target.lng - from.current!.lng) * e };
      shown.current = p;
      setPoint(p);
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target?.lat, target?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return { point, heading };
}
