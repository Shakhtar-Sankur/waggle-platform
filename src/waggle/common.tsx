import { Capacitor } from "@capacitor/core";
import { Home, Receipt, Search, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useT } from "../i18n";
import { Wordmark } from "../components/Wordmark";

/**
 * A link anyone can open: the Waggle website once it is published
 * (VITE_WAGGLE_WEB_URL), or this site's own address in a browser. Inside the
 * phone app there is no public address until the website exists, so null.
 */
export function webLink(path: string): string | null {
  const base = (import.meta.env.VITE_WAGGLE_WEB_URL as string | undefined)?.replace(/\/$/, "");
  if (base) return `${base}${path}`;
  return Capacitor.isNativePlatform() ? null : `${window.location.origin}${path}`;
}

export const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])m/i, " $1m").toLowerCase() : "";

export const dayAndTime = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}, ${clock(iso)}`;

/** Minutes between two moments, rounded, never below one. */
export const minutesBetween = (from: string, to: string) => Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));

/* ------------------------------------------------------------------ remembered on this phone only */

export interface RecentOrder {
  token: string;
  code: string;
  shop: string;
  shopId: string;
  at: string;
}

const RECENT = "waggle_recent_orders";
const CONTACT = "waggle_contact";
const REORDER = "waggle_reorder";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and full storage: the app works, it just does not remember.
  }
}

export const recentOrders = () => read<RecentOrder[]>(RECENT, []);
export function rememberOrder(order: RecentOrder) {
  write(RECENT, [order, ...recentOrders().filter((o) => o.token !== order.token)].slice(0, 12));
}

export interface Contact { name: string; phone: string; area: string; address: string; lat: number | null; lng: number | null }
export const savedContact = () => read<Contact | null>(CONTACT, null);
export const saveContact = (contact: Contact) => write(CONTACT, contact);

export interface ReorderLine { itemId: string; qty: number; selection: [number, number][] }

/** A basket carried from a past order back to the shop's page, choices included. */
export const takeReorder = (shopId: string): ReorderLine[] => {
  const saved = read<{ shopId: string; lines: ReorderLine[] } | null>(REORDER, null);
  try { localStorage.removeItem(REORDER); } catch { /* nothing to clear */ }
  return saved && saved.shopId === shopId && Array.isArray(saved.lines) ? saved.lines : [];
};
export const setReorder = (shopId: string, lines: ReorderLine[]) => write(REORDER, { shopId, lines });

/* Group baskets this phone is part of: the name used, and the host's key if it started one. */
const GROUPS = "waggle_groups";
export const groupMemory = (token: string) => read<Record<string, { hostKey?: string; member?: string }>>(GROUPS, {})[token] ?? {};
export function rememberGroup(token: string, info: { hostKey?: string; member?: string }) {
  const all = read<Record<string, { hostKey?: string; member?: string }>>(GROUPS, {});
  write(GROUPS, { ...all, [token]: { ...all[token], ...info } });
}

/* ------------------------------------------------------------------ the frame */

export function WgFrame({ children, bar, nav }: { children: ReactNode; bar?: ReactNode; nav?: boolean }) {
  const t = useT();
  return (
    <div className={`wg-frame${nav ? " has-nav" : ""}`}>
      <header className="wg-appbar">
        <Link to="/" className="wg-brand" aria-label="Waggle home"><Wordmark /></Link>
        {bar}
      </header>
      {children}
      {nav ? (
        <nav className="wg-nav" aria-label="Waggle">
          <NavLink to="/" end><Home size={20} /><span>{t("wg_navHome")}</span></NavLink>
          <NavLink to="/search"><Search size={20} /><span>{t("wg_navSearch")}</span></NavLink>
          <NavLink to="/orders"><Receipt size={20} /><span>{t("wg_navOrders")}</span></NavLink>
          <NavLink to="/account"><UserRound size={20} /><span>{t("wg_navAccount")}</span></NavLink>
        </nav>
      ) : null}
    </div>
  );
}
