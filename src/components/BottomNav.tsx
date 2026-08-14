import { Home, Map, MessageCircle, UserRound, UsersRound } from "lucide-react";
import { WorkAppMark } from "./WorkAppMark";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useT } from "../i18n";
import { useLocationStore } from "../stores/useLocationStore";
import { useProfileStore } from "../stores/useProfileStore";
import { getWorkApp } from "../utils/workApps";

export function BottomNav() {
  const t = useT();
  const activeApp = useProfileStore((state) => state.activeApp);
  const totalDistanceKm = useLocationStore((state) => state.totalDistanceKm);
  const app = getWorkApp(activeApp);

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">
        <NavItem to="/home" label={t("nav_home")} icon={<Home size={21} />} />
        <NavItem to="/community" label={t("nav_community")} icon={<UsersRound size={21} />} />
        <NavItem
          to="/routes"
          label={t("nav_routes")}
          subLabel={app ? `${totalDistanceKm.toFixed(1)}km` : undefined}
          icon={
            <span className="nav-live-icon">
              <Map size={21} />
              {app ? <WorkAppMark app={app} size={16} /> : null}
            </span>
          }
        />
        <NavItem to="/messages" label={t("nav_messages")} icon={<MessageCircle size={21} />} />
        <NavItem to="/profile" label={t("nav_profile")} icon={<UserRound size={21} />} />
      </div>
    </nav>
  );
}

function NavItem({
  to,
  icon,
  label,
  subLabel,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  subLabel?: string;
}) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
      {icon}
      <span>{label}</span>
      {subLabel ? <em>{subLabel}</em> : null}
    </NavLink>
  );
}
