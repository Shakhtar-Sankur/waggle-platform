import { Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { useT } from "../i18n";
import { RatingService, type DeliveryRating } from "../services/RatingService";

/** The rider's standing and this viewer's rating of the delivery, from a tracking token. */
export function useDeliveryRating(token: string, delivered: boolean) {
  const [rating, setRating] = useState<DeliveryRating | null>(null);
  const load = useCallback(() => {
    void RatingService.forDelivery(token).then(setRating).catch(() => undefined);
  }, [token]);
  useEffect(() => { load(); }, [load, delivered]);
  return [rating, load] as const;
}

/** "4.8 ★ · 23": shown beside the rider's name once they have 3 ratings. */
export function RiderAverage({ rating }: { rating: DeliveryRating | null }) {
  const t = useT();
  if (!rating?.avg) return null;
  return <em className="wg-rating wg-rider-avg"><Star size={11} fill="currentColor" /> {t("wg_rrAvg", { avg: rating.avg.toFixed(1), count: String(rating.count) })}</em>;
}

/**
 * After delivery: rate the rider, 1 to 5. The rider sees only their average;
 * a reason goes to Gigzen alone, so a low rating can be followed up.
 */
export function RateRider({ token, via, rider, rating, onDone }: {
  token: string;
  via: "order" | "send";
  rider: string;
  rating: DeliveryRating | null;
  onDone: () => void;
}) {
  const t = useT();
  const [stars, setStars] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!rating) return null;
  if (rating.rated) {
    return <p className="wg-rated wg-rr-done"><Star size={16} fill="currentColor" /> {t("wg_rrDone", { rider, stars: String(rating.rated) })}</p>;
  }
  if (!rating.canRate) return null;

  async function send() {
    setBusy(true);
    setError("");
    try {
      const answer = via === "order" ? await RatingService.rateFromOrder(token, stars, reason) : await RatingService.rateFromSend(token, stars, reason);
      if (answer === "ok" || answer === "already") onDone();
      else setError(t("biz_errGeneric"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="wg-card wg-rr">
      <h2 className="wg-h2">{t("wg_rrTitle", { rider })}</h2>
      <div className="wg-stars" role="radiogroup" aria-label={t("wg_rrTitle", { rider })}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={t("wg_starsN", { n: String(n) })}
            className={n <= stars ? "is-on" : ""} onClick={() => setStars(n)}>
            <Star size={30} fill={n <= stars ? "currentColor" : "none"} />
          </button>
        ))}
      </div>
      {stars ? (
        <>
          <textarea className="wg-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2}
            placeholder={t(stars <= 3 ? "wg_rrPhLow" : "wg_rrPhHigh")} />
          <p className="wg-fine">{t("wg_rrPrivate", { rider })}</p>
          {error ? <p className="wg-error">{error}</p> : null}
          <Button disabled={busy} onClick={() => void send()}>{t("wg_rrSend", { rider })}</Button>
        </>
      ) : null}
    </section>
  );
}
