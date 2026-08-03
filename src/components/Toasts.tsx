import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNotificationStore } from "../stores/useNotificationStore";
import { Button } from "./ui/Button";

// How long a toast stays on screen before it slides away on its own.
const TOAST_DURATION_MS = 4500;

export function Toasts() {
  const notifications = useNotificationStore((state) => state.notifications);
  // Only surface notifications that arrive after this component mounts, so old
  // history never pops up as toasts on load/navigation.
  const mountedAt = useRef(Date.now());
  const [dismissed, setDismissed] = useState<string[]>([]);

  const visible = notifications
    .filter((n) => !n.read && !dismissed.includes(n.id) && n.createdAt >= mountedAt.current)
    .slice(0, 2);

  const visibleKey = visible.map((n) => n.id).join("|");

  useEffect(() => {
    if (!visible.length) return undefined;
    const timers = visible.map((n) =>
      window.setTimeout(
        () => setDismissed((prev) => (prev.includes(n.id) ? prev : [...prev, n.id])),
        TOAST_DURATION_MS,
      ),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // visibleKey captures the exact set of toasts currently shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  // Dismissing a toast only hides it — the notification stays in the
  // notifications list (bell) so nothing is lost.
  const dismiss = (id: string) =>
    setDismissed((prev) => (prev.includes(id) ? prev : [...prev, id]));

  return (
    <div className="toast-stack" aria-live="polite">
      {visible.map((notification) => (
        <article className="toast glass-card-elevated" key={notification.id}>
          <div>
            <strong>{notification.title}</strong>
            <p>{notification.description}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => dismiss(notification.id)}
            aria-label="Dismiss"
          >
            <X size={16} />
          </Button>
        </article>
      ))}
    </div>
  );
}
