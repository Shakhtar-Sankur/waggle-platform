import { History, House, UserRound, UsersRound, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useT } from "../i18n";
import { useJobStore } from "../stores/useJobStore";

/**
 * Waggle Gig's five tabs: work, money, what was done, riders together, you.
 * Home carries a dot while a job is in hand, so it is never lost behind
 * another tab.
 */
export function BottomNav() {
  const t = useT();
  const onJob = useJobStore((state) => state.jobs.some((j) => j.status === "accepted" || j.status === "picked_up"));

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">
        <NavItem to="/home" label={t("nav_home")} icon={<House size={21} />} dot={onJob} />
        <NavItem to="/earnings" label={t("gg_navEarnings")} icon={<Wallet size={21} />} />
        <NavItem to="/history" label={t("gg_navHistory")} icon={<History size={21} />} />
        <NavItem to="/community" label={t("nav_community")} icon={<UsersRound size={21} />} />
        <NavItem to="/profile" label={t("nav_profile")} icon={<UserRound size={21} />} />
      </div>
    </nav>
  );
}

function NavItem({ to, icon, label, dot }: { to: string; icon: ReactNode; label: string; dot?: boolean }) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
      {/* The icon is wrapped so the active pill is anchored to it rather than
          to the link box. */}
      <span className="nav-ico">{icon}{dot ? <i className="gg-navdot" aria-hidden /> : null}</span>
      <span>{label}</span>
    </NavLink>
  );
}
