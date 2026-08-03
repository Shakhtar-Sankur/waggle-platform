import { WORK_APPS } from "../config/constants";
import type { WorkApp, WorkAppId } from "../types";

export function getWorkApp(id: WorkAppId | null | undefined) {
  return WORK_APPS.find((app) => app.id === id) ?? null;
}

/** True when the platform operates in the given country. */
function servesCountry(app: WorkApp, country: string | undefined): boolean {
  if (!country || !app.regions?.length) return false;
  return app.regions.includes(country);
}

/**
 * Platforms ordered for a driver in `country`: the ones that actually operate
 * where they are come first, then everything else alphabetically. "Others" is
 * always pinned last so it reads as the fallback it is.
 */
export function workAppsForCountry(country: string | undefined): WorkApp[] {
  const rest = WORK_APPS.filter((app) => app.id !== "others");
  const local = rest.filter((app) => servesCountry(app, country));
  const global = rest
    .filter((app) => !servesCountry(app, country))
    .sort((a, b) => a.name.localeCompare(b.name));
  const others = WORK_APPS.filter((app) => app.id === "others");
  return [...local, ...global, ...others];
}

/** How many of the ordered list are local to the driver's country. */
export function localAppCount(country: string | undefined): number {
  return WORK_APPS.filter((app) => app.id !== "others" && servesCountry(app, country)).length;
}

/** Name search across the catalogue, keeping the country-aware order. */
export function searchWorkApps(query: string, country: string | undefined): WorkApp[] {
  const q = query.trim().toLowerCase();
  const ordered = workAppsForCountry(country);
  if (!q) return ordered;
  return ordered.filter((app) => app.name.toLowerCase().includes(q));
}
