import { Briefcase, Home, LocateFixed, MapPin, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT, type TKey } from "../i18n";
import { LocationService } from "../services/LocationService";
import { useAuthStore } from "../stores/useAuthStore";
import { MapPicker, type LatLng } from "../business/MapPicker";
import { useWaggleLocation } from "./useWaggleLocation";
import { WaggleService, type SavedAddress } from "./WaggleService";

const LABEL_ICON = { home: <Home size={16} />, work: <Briefcase size={16} />, other: <MapPin size={16} /> };
export const LABEL_KEY: Record<SavedAddress["label"], TKey> = { home: "wg_labelHome", work: "wg_labelWork", other: "wg_labelOther" };

/** Choose where to deliver: here (GPS), a saved place, or a pin on the map. */
export function LocationSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const { place, setPlace } = useWaggleLocation();
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [pin, setPin] = useState<LatLng | null>(place ? { lat: place.lat, lng: place.lng } : null);
  const [area, setArea] = useState(place?.label === "pin" ? place.area : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) void WaggleService.addresses().then(setSaved).catch(() => undefined);
  }, [user]);

  async function here() {
    setBusy(true);
    setError("");
    try {
      const p = await LocationService.currentPosition();
      setPlace({ lat: p.lat, lng: p.lng, area: t("wg_currentLocation"), label: "gps" });
      onClose();
    } catch {
      setError(t("wg_locateFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wg-sheet-backdrop" onClick={onClose}>
      <section className="wg-sheet wg-locsheet" role="dialog" aria-modal="true" aria-label={t("wg_whereTitle")} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="wg-sheet-close" onClick={onClose} aria-label={t("wg_close")}><X size={18} /></button>
        <div className="wg-sheet-body">
          <h2>{t("wg_whereTitle")}</h2>
          <button type="button" className="wg-locrow wg-locrow-gps" onClick={() => void here()} disabled={busy}>
            <LocateFixed size={18} />
            <span><strong>{busy ? t("biz_locating") : t("wg_useCurrent")}</strong><small>{t("wg_useCurrentSub")}</small></span>
          </button>
          {error ? <p className="wg-error">{error}</p> : null}
          {saved.length ? (
            <div className="wg-locsaved">
              <h3>{t("wg_savedPlaces")}</h3>
              {saved.map((a) => (
                <button key={a.id} type="button" className="wg-locrow"
                  onClick={() => { setPlace({ lat: a.lat, lng: a.lng, area: a.area, address: a.address, label: a.label }); onClose(); }}>
                  {LABEL_ICON[a.label]}
                  <span><strong>{t(LABEL_KEY[a.label])} · {a.area}</strong><small>{a.address}</small></span>
                </button>
              ))}
            </div>
          ) : null}
          <h3>{t("wg_pinTitle")}</h3>
          <MapPicker value={pin} onChange={setPin} height={220} />
          <input className="wg-input" value={area} onChange={(e) => setArea(e.target.value)} placeholder={t("wg_areaNamePh")} maxLength={60} />
        </div>
        <footer className="wg-sheet-foot">
          <button type="button" className="wg-btn wg-btn-primary" disabled={!pin || area.trim().length < 2}
            onClick={() => { if (pin) { setPlace({ lat: pin.lat, lng: pin.lng, area: area.trim(), label: "pin" }); onClose(); } }}>
            {t("wg_deliverHere")}
          </button>
        </footer>
      </section>
    </div>
  );
}
