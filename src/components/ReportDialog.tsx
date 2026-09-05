import { useState } from "react";
import { Flag, ShieldOff } from "lucide-react";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { useT } from "../i18n";
import { useCommunityStore } from "../stores/useCommunityStore";

/** What is being reported. `user` is a report about the person, not a post. */
export type ReportTarget = {
  type: "post" | "message" | "user";
  id: string;
  /** Who wrote it, so repeated reports about one driver can be counted. */
  userId?: string;
  /** The name shown in the confirmation, and on the block button. */
  authorName?: string;
  /** A snapshot of the reported text, stored with the report. */
  excerpt?: string;
};

const REASONS = [
  ["spam", "mod_reasonSpam"],
  ["harassment", "mod_reasonHarassment"],
  ["hate", "mod_reasonHate"],
  ["violence", "mod_reasonViolence"],
  ["sexual", "mod_reasonSexual"],
  ["other", "mod_reasonOther"],
] as const;

/**
 * Report something, and optionally block the person who posted it.
 *
 * The two live in one dialog because they are one thought. Somebody who has
 * just reported harassment does not want to hunt for a second control to stop
 * seeing the person — so blocking is offered on the confirmation step, already
 * aimed at the right driver.
 *
 * Reporting is deliberately not gated on choosing a reason well: the reasons
 * are one tap, the note is optional, and the report sends on the first screen.
 * A form that demands an essay gets abandoned by the people most likely to need
 * it.
 */
export function ReportDialog({
  target,
  onClose,
}: {
  target: ReportTarget | null;
  onClose: () => void;
}) {
  const t = useT();
  const reportContent = useCommunityStore((s) => s.reportContent);
  const blockUser = useCommunityStore((s) => s.blockUser);
  const blocked = useCommunityStore((s) => s.blocked);

  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("spam");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!target) return null;

  const isBlocked = target.userId ? blocked.includes(target.userId) : false;

  const close = () => {
    // Reset, or reopening the dialog shows the previous report's confirmation.
    setReason("spam");
    setNote("");
    setSent(false);
    setFailed(false);
    setSending(false);
    onClose();
  };

  const send = async () => {
    setSending(true);
    setFailed(false);
    try {
      await reportContent({
        targetType: target.type,
        targetId: target.id,
        targetUser: target.userId,
        reason,
        note: note.trim() || undefined,
        excerpt: target.excerpt,
      });
      setSent(true);
    } catch {
      // Say so rather than closing on a silent failure — a report the driver
      // believes was filed, and was not, is worse than an error.
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  const title =
    target.type === "post" ? t("mod_reportPost")
    : target.type === "message" ? t("mod_reportMessage")
    : t("mod_reportUser");

  return (
    <Modal open onClose={close} title={sent ? t("mod_reportSent") : title}>
      {sent ? (
        <div className="report-done">
          <p>{t("mod_reportSentBody")}</p>
          {target.userId && !isBlocked ? (
            <Button
              variant="outline"
              className="wide-action"
              onClick={async () => {
                try { await blockUser(target.userId!); } catch { /* stays visible */ }
                close();
              }}
            >
              <ShieldOff size={17} /> {t("mod_block")}
              {target.authorName ? ` · ${target.authorName}` : ""}
            </Button>
          ) : null}
          <Button className="wide-action" onClick={close}>{t("common_done")}</Button>
        </div>
      ) : (
        <div className="report-form">
          <p className="report-why">{t("mod_reportWhy")}</p>
          <div className="report-reasons" role="radiogroup" aria-label={t("mod_reportWhy")}>
            {REASONS.map(([value, key]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={reason === value}
                className={reason === value ? "report-reason active" : "report-reason"}
                onClick={() => setReason(value)}
              >
                {t(key)}
              </button>
            ))}
          </div>

          <label className="report-note">
            <span>{t("mod_reportNote")}</span>
            <textarea
              value={note}
              maxLength={1000}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {failed ? <p className="report-failed">{t("err_unexpected")}</p> : null}

          <Button className="wide-action" onClick={send} disabled={sending}>
            <Flag size={17} /> {t("mod_reportSend")}
          </Button>
        </div>
      )}
    </Modal>
  );
}
