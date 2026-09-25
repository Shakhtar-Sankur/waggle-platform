import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { useT } from "../i18n";
import { GigService, type TicketTopic } from "./GigService";

export const TOPICS: TicketTopic[] = ["payment", "delivery", "account", "app", "safety", "other"];

/** Ask Gigzen for help, about a delivery or anything else. The answer arrives as a notification. */
export function HelpSheet({
  open,
  onClose,
  jobId,
  jobLabel,
  topic: initialTopic = "delivery",
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  jobId?: string;
  jobLabel?: string;
  topic?: TicketTopic;
  onSent?: () => void;
}) {
  const t = useT();
  const [topic, setTopic] = useState<TicketTopic>(initialTopic);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTopic(initialTopic);
    setMessage("");
    setError("");
    setSent(false);
  }, [open, initialTopic]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (message.trim().length < 10) {
      setError(t("gg_helpTooShort"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await GigService.openTicket(topic, message, jobId);
      setSent(true);
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("job_stepError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("gg_helpTitle")} description={jobLabel ? t("gg_helpAbout", { job: jobLabel }) : t("gg_helpSub")}>
      {sent ? (
        <div className="settings-form">
          <p className="gg-sent">{t("gg_helpSent")}</p>
          <Button onClick={onClose}>{t("common_done")}</Button>
        </div>
      ) : (
        <form className="settings-form" onSubmit={submit}>
          <div className="gg-chips" role="radiogroup" aria-label={t("gg_helpTopic")}>
            {TOPICS.map((k) => (
              <button type="button" key={k} role="radio" aria-checked={topic === k} className={topic === k ? "is-on" : ""} onClick={() => setTopic(k)}>
                {t(`gg_topic_${k}` as "gg_topic_payment")}
              </button>
            ))}
          </div>
          <label>
            <span>{t("gg_helpMessage")}</span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={1000} placeholder={t("gg_helpPh")} />
          </label>
          {topic === "safety" ? <p className="gg-sos-note">{t("gg_helpSafety")}</p> : null}
          {error ? <p className="job-message" role="alert">{error}</p> : null}
          <Button type="submit" disabled={busy}>{t("gg_helpSend")}</Button>
        </form>
      )}
    </Modal>
  );
}
