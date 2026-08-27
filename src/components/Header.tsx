import { Bell, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { APP_NAME } from "../config/constants";
import { useT } from "../i18n";
import { BeeMark, Wordmark } from "./Wordmark";
import { useNotificationStore } from "../stores/useNotificationStore";
import { Button } from "./ui/Button";

interface HeaderProps {
  title: string;
}

/** Scroll distance after which the large title collapses into a compact bar. */
const COLLAPSE_AT = 28;

export function Header({ title }: HeaderProps) {
  const navigate = useNavigate();
  const t = useT();
  const unread = useNotificationStore(
    (state) => state.notifications.filter((notification) => !notification.read).length,
  );

  // The header starts transparent on the page background and only takes on a
  // surface once content has scrolled under it — so at rest the screen reads as
  // one page rather than a coloured chrome bar with content below it.
  const [collapsed, setCollapsed] = useState(() => window.scrollY > COLLAPSE_AT);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      // Scroll fires far more often than the state can usefully change; coalesce
      // to one read per frame.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setCollapsed(window.scrollY > COLLAPSE_AT);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Translate the known screen titles; the brand name stays as-is.
  const titles: Record<string, string> = {
    Messages: t("nav_messages"),
    Profile: t("nav_profile"),
    Notifications: t("notif_title"),
    Community: t("nav_community"),
    Routes: t("nav_routes"),
  };

  const isHome = title === APP_NAME;

  return (
    <header className={collapsed ? "app-header is-collapsed" : "app-header"}>
      <div className="shell-row">
        {/* The mark appears on every screen, at one size.
            It used to be: the full wordmark on Home, a bare bee at 30px on
            Community, another at 26px on Routes, and nothing at all on
            Messages or Profile — five headers, four treatments, and no size
            repeated. A logo that changes size from page to page reads as four
            different logos.

            Home still gets the wordmark, because there the brand IS the title.
            Everywhere else the mark sits beside the screen's own name, which
            is what those screens need to say. */}
        {isHome ? (
          <h1 className="header-brand">
            <Wordmark size={collapsed ? 20 : 27} />
          </h1>
        ) : (
          <h1 className="header-titled">
            <BeeMark size={26} className="header-mark" />
            {titles[title] ?? title}
          </h1>
        )}
        <div className="header-actions">
          <Button
            variant="ghost"
            size="icon"
            className="header-icon"
            onClick={() => navigate("/notifications")}
            aria-label={t("a11y_notifications")}
          >
            <Bell size={19} />
            {unread > 0 ? <span className="header-dot" /> : null}
          </Button>
          {/* Settings only where settings live. On Home and Messages it was a
              shortcut into a screen already one tap away in the bottom nav.
              Log out was here too: a destructive action on every screen, when
              Profile already carries a full-width Log Out button. */}
          {title === "Profile" ? (
            <Button
              variant="ghost"
              size="icon"
              className="header-icon"
              onClick={() => navigate("/profile?settings=true")}
              aria-label={t("a11y_settings")}
            >
              <Settings size={19} />
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
