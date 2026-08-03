import { Bell, LogOut, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { APP_NAME } from "../config/constants";
import { useT } from "../i18n";
import { Wordmark } from "./Wordmark";
import { useAuthStore } from "../stores/useAuthStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import { Button } from "./ui/Button";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const navigate = useNavigate();
  const t = useT();
  const signOut = useAuthStore((state) => state.signOut);
  const unread = useNotificationStore(
    (state) => state.notifications.filter((notification) => !notification.read).length,
  );

  // Translate the known screen titles; the brand name stays as-is.
  const titles: Record<string, string> = {
    Messages: t("nav_messages"),
    Profile: t("nav_profile"),
    Notifications: t("notif_title"),
    Community: t("nav_community"),
    Routes: t("nav_routes"),
  };

  return (
    <header className="app-header">
      <div className="shell-row">
        {/* On Home the title IS the brand, so show the mark instead of plain text. */}
        {title === APP_NAME ? (
          <h1 className="header-brand">
            <Wordmark size={21} tone="solid" />
          </h1>
        ) : (
          <h1>{titles[title] ?? title}</h1>
        )}
        <div className="header-actions">
          <Button
            variant="ghost"
            size="icon"
            className="header-icon"
            onClick={() => navigate("/notifications")}
            aria-label="Notifications"
          >
            <Bell size={19} />
            {unread > 0 ? <span className="header-dot" /> : null}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="header-icon"
            onClick={() => navigate("/profile?settings=true")}
            aria-label="Settings"
          >
            <Settings size={19} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="header-icon"
            onClick={() => {
              signOut();
              navigate("/auth");
            }}
            aria-label="Log out"
          >
            <LogOut size={19} />
          </Button>
        </div>
      </div>
    </header>
  );
}
