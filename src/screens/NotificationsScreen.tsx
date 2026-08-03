import { Bell, CheckCheck } from "lucide-react";
import { Button } from "../components/ui/Button";
import { useT } from "../i18n";
import { useNotificationStore } from "../stores/useNotificationStore";
import { timeAgo } from "../utils/format";

export function NotificationsScreen() {
  const t = useT();
  const notifications = useNotificationStore((state) => state.notifications);
  const markAllRead = useNotificationStore((state) => state.markAllRead);

  return (
    <main className="page-shell">
      <section className="dashboard-card glass-card">
        <div className="section-heading">
          <h3><Bell size={19} /> {t("notif_title")}</h3>
          {notifications.length ? (
            <Button variant="outline" size="sm" onClick={markAllRead}><CheckCheck size={16} /> {t("notif_markRead")}</Button>
          ) : null}
        </div>
        <div className="notification-list">
          {notifications.length ? (
            notifications.map((notification) => (
              <article className={notification.read ? "read" : ""} key={notification.id}>
                <span />
                <div>
                  <strong>{notification.title}</strong>
                  <p>{notification.description}</p>
                  <small>{timeAgo(notification.createdAt)}</small>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <Bell size={34} />
              <p>{t("notif_empty")}</p>
              <span>{t("notif_emptySub")}</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
