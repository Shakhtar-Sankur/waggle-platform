import { Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Tooltip, useMap } from "react-leaflet";
import { VectorBasemap } from "../components/VectorBasemap";
import { useT } from "../i18n";
import { HeadingMarker } from "../maps/HeadingMarker";
import { useSmoothPoint } from "../maps/useSmoothPoint";
import { BusinessService, type Business, type LiveRider } from "./BusinessService";

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.map((n) => n.toFixed(3)).join(",")).join("|");
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points, { padding: [36, 36], maxZoom: 15 });
    else if (points[0]) map.setView(points[0], 14);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Rider({ r }: { r: LiveRider }) {
  const t = useT();
  const target = r.riderLat != null && r.riderLng != null ? { lat: r.riderLat, lng: r.riderLng } : null;
  const { point, heading } = useSmoothPoint(target, 7000);
  if (!point) return null;
  return (
    <HeadingMarker at={point} heading={heading} colour={r.status === "picked_up" ? "#16a34a" : "#f59e0b"}
      label={`${r.rider} · ${t(r.status === "picked_up" ? "bx_liveToCustomer" : "bx_liveToShop")}`} permanent />
  );
}

/**
 * The shop's deliveries in progress on one map: each rider live, amber on the
 * way to the shop, green on the way to the customer, with a line to where
 * that order is going. Only the shop's own deliveries, and only while they
 * are being carried (business_live_riders in maps_v1.sql).
 */
export function LiveDeliveriesMap({ business, activeCount }: { business: Business; activeCount: number }) {
  const t = useT();
  const [riders, setRiders] = useState<LiveRider[]>([]);

  useEffect(() => {
    if (!activeCount) { setRiders([]); return; }
    let live = true;
    const load = () => BusinessService.liveRiders(business.id).then((r) => live && setRiders(r)).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 8000);
    return () => { live = false; window.clearInterval(timer); };
  }, [business.id, activeCount]);

  const points = useMemo(() => {
    const p: [number, number][] = [[business.lat, business.lng]];
    for (const r of riders) {
      if (r.dropLat != null && r.dropLng != null) p.push([r.dropLat, r.dropLng]);
      if (r.riderLat != null && r.riderLng != null) p.push([r.riderLat, r.riderLng]);
    }
    return p;
  }, [riders, business.lat, business.lng]);

  if (!activeCount) return null;
  const quiet = riders.filter((r) => r.riderLat == null).length;

  return (
    <section className="biz-card biz-livemap">
      <div className="biz-card-head">
        <strong><Radio size={16} /> {t("bx_liveTitle", { n: String(activeCount) })}</strong>
        <span className="biz-livedot">{t("bx_liveNow")}</span>
      </div>
      <div className="biz-livemap-map">
        <MapContainer center={[business.lat, business.lng]} zoom={14} zoomControl={false} attributionControl={false} scrollWheelZoom={false} style={{ height: "100%" }}>
          <VectorBasemap />
          <Fit points={points} />
          <CircleMarker center={[business.lat, business.lng]} radius={10} pathOptions={{ color: "#fff", weight: 3, fillColor: "#0f172a", fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -10]}>{business.name}</Tooltip>
          </CircleMarker>
          {riders.map((r) => (
            r.dropLat != null && r.dropLng != null ? (
              <CircleMarker key={`d-${r.jobId}`} center={[r.dropLat, r.dropLng]} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#4F46E5", fillOpacity: 1 }}>
                <Tooltip direction="top" offset={[0, -8]}>{r.dropoff}</Tooltip>
              </CircleMarker>
            ) : null
          ))}
          {riders.map((r) => (
            r.status === "picked_up" && r.riderLat != null && r.riderLng != null && r.dropLat != null && r.dropLng != null ? (
              <Polyline key={`l-${r.jobId}`} positions={[[r.riderLat, r.riderLng], [r.dropLat, r.dropLng]]} pathOptions={{ color: "#16a34a", weight: 2, dashArray: "4 8", opacity: 0.8 }} />
            ) : null
          ))}
          {riders.map((r) => <Rider key={`r-${r.jobId}`} r={r} />)}
        </MapContainer>
      </div>
      <p className="biz-help">
        <span className="biz-legend is-amber" /> {t("bx_liveToShop")} · <span className="biz-legend is-green" /> {t("bx_liveToCustomer")}
        {quiet ? ` · ${t("bx_liveQuiet", { n: String(quiet) })}` : ""}
      </p>
    </section>
  );
}
