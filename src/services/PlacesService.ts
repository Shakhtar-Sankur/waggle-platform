/**
 * Place search, behind a seam.
 *
 * The search lived inside RoutesScreen as one 90-line function: two fetches, a
 * de-duplicate, a five-tier sort and the Nominatim response shape, all mixed
 * into a component. That works until you want to buy a better index — and this
 * app probably will, because OpenStreetMap is strong on addresses and weak on
 * businesses, which is most of what a driver types.
 *
 * So: a provider interface, a Nominatim implementation of it, and ranking that
 * belongs to the app rather than to whoever is answering. Swapping in Google
 * Places or Mapbox means writing one `search()` and setting VITE_PLACES_PROVIDER
 * — the ranking, the de-duplication and the UI do not move, and the two can run
 * side by side while you compare them.
 */

/** Where the driver is, for biasing and ranking. */
export interface Near {
  lat: number;
  lng: number;
}

export interface PlaceHit {
  lat: number;
  lng: number;
  /** What to show in bold — a name, or the first line of an address. */
  label: string;
  /** The rest of the address, already trimmed to something readable. */
  sub: string;
  /** A settlement or district, as opposed to a street or a shop. */
  isPlace?: boolean;
  /** Big enough that somebody would type its name from another country — a
   *  city, state or country, never a village or a suburb. */
  isMajorPlace?: boolean;
}

export interface PlacesProvider {
  readonly id: string;
  /**
   * Results for `query`, biased toward `near` but NOT limited to it. A provider
   * that only ever returns nearby hits makes "Madrid" unsearchable from Mumbai;
   * one that ignores `near` entirely makes "7-Eleven" useless. Both matter, so
   * the contract asks for both and lets rankHits sort it out.
   */
  search(query: string, near: Near, signal?: AbortSignal): Promise<PlaceHit[]>;
}

/** Kilometres between two points. Equirectangular — accurate to well under a
 *  percent at the distances this is used for, and far cheaper than haversine
 *  when it runs over every hit on every keystroke. */
export function distanceKm(a: Near, b: Near): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = (((b.lng - a.lng) * Math.PI) / 180) * Math.cos(((a.lat + b.lat) / 2 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng) * R;
}

/**
 * How close counts as "here".
 *
 * 60km covers a metro area and the trips a driver actually makes, and never
 * reaches the next state. It is in REAL kilometres — the version of this check
 * that shipped an hour ago compared squared degrees against 60, which is about
 * 860km, so a city most of a country away still counted as nearby. It happened
 * to fix the case it was written for and would have failed the next one.
 */
const NEARBY_KM = 60;

/**
 * Rank hits for a driver standing at `near`.
 *
 * In order:
 *  1. the name actually matches what was typed;
 *  2. RELEVANT — either close by, or a place big enough to be typed from
 *     another country;
 *  3. among those, a major place first;
 *  4. then any place before a street or shop;
 *  5. then nearest.
 *
 * Tier 2 is the one that is easy to leave out and expensive to miss. Without
 * it, "Andheri" from Mumbai returned villages in Punjab and Rajasthan — 1,400km
 * away and tagged `village`, which counted as a settlement — above Andheri
 * East, eight kilometres from the driver, which is tagged `suburb` and did not.
 *
 * The three cases this has to satisfy at once:
 *   "Andheri" from Mumbai  → near suburb beats far villages;
 *   "Madrid" from Mumbai   → nothing is near, the city is major, so it wins;
 *   "7-Eleven" from Manila → near branches beat the ones in Thailand.
 */
export function rankHits(hits: PlaceHit[], query: string, near: Near, limit = 6): PlaceHit[] {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = key(query);

  // De-duplicated on BOTH coordinates and text. Coordinates alone are not
  // enough: OSM holds a bridge as a way and again as a node a few metres
  // apart, so "Howrah Bridge · Howrah Maidan" came back twice, and "Salt Lake
  // Sector V · Salt Lake Bypass, CL Block" twice more. Two rows a driver
  // cannot tell apart are worse than one, whatever the database thinks.
  //
  // Coordinates are rounded to ~11m before comparing, which catches the same
  // place mapped twice without merging two genuinely different shops in one
  // building.
  const seen = new Set<string>();
  const unique = hits.filter((h) => {
    const byCoord = `${h.lat.toFixed(4)},${h.lng.toFixed(4)}`;
    const byText = `${h.label}|${h.sub}`.toLowerCase();
    if (seen.has(byCoord) || seen.has(byText)) return false;
    seen.add(byCoord);
    seen.add(byText);
    return true;
  });

  const matches = (hit: PlaceHit) => {
    const name = key(hit.label);
    return name.includes(wanted) || wanted.includes(name) ? 0 : 1;
  };
  const relevant = (hit: PlaceHit) =>
    distanceKm(near, hit) <= NEARBY_KM || hit.isMajorPlace ? 0 : 1;

  return [...unique]
    .sort((a, b) => {
      const byMatch = matches(a) - matches(b);
      if (byMatch !== 0) return byMatch;
      const byRelevance = relevant(a) - relevant(b);
      if (byRelevance !== 0) return byRelevance;
      const byMajor = Number(b.isMajorPlace) - Number(a.isMajorPlace);
      if (byMajor !== 0) return byMajor;
      const byPlace = Number(b.isPlace) - Number(a.isPlace);
      if (byPlace !== 0) return byPlace;
      return distanceKm(near, a) - distanceKm(near, b);
    })
    .slice(0, limit);
}

/** Settlement types worth typing from another country. */
const MAJOR_TYPES = ["city", "state", "region", "province", "municipality", "county", "country"];
/** Everything that is a place of some kind, major or not. */
const PLACE_TYPES = [...MAJOR_TYPES, "town", "village", "suburb", "neighbourhood", "borough", "quarter"];

interface NominatimRow {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  class?: string;
  type?: string;
}

/**
 * OpenStreetMap's own geocoder. Free, no key, worldwide, and the reason this
 * app can search Kolkata, Madrid and New York today without an account.
 *
 * Its weakness is businesses: it knows a shop exists if a mapper added it, and
 * has no opening hours, ratings or popularity. That is the gap a paid provider
 * would fill, and the reason for the interface above.
 */
export const NominatimProvider: PlacesProvider = {
  id: "nominatim",

  async search(query, near, signal) {
    // TWO searches, merged — neither alone is enough:
    //   local only  → "Madrid" returns a Mumbai side-street named Madrid and
    //                 never the Spanish capital.
    //   global only → "7-Eleven" returns branches in Thailand instead of the
    //                 one down the road.
    const d = 1.5; // ~165km box around the driver
    const viewbox = [near.lng - d, near.lat + d, near.lng + d, near.lat - d].join(",");

    const fetchHits = async (bounded: 0 | 1): Promise<NominatimRow[]> => {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=12&addressdetails=1` +
          `&viewbox=${viewbox}&bounded=${bounded}&q=${encodeURIComponent(query)}`,
        { headers: { Accept: "application/json" }, signal },
      );
      const body = await response.json();
      return Array.isArray(body) ? body : [];
    };

    // In parallel, so the driver is not waiting twice.
    const [nearby, worldwide] = await Promise.all([fetchHits(1), fetchHits(0)]);

    return [...nearby, ...worldwide].map((r) => {
      const parts = (r.display_name || "").split(",").map((s) => s.trim());
      const isAdmin = r.class === "boundary" && r.type === "administrative";
      return {
        lat: Number(r.lat),
        lng: Number(r.lon),
        label: r.name || parts[0] || query,
        sub: parts.slice(1, 4).join(", "),
        isMajorPlace: isAdmin || (r.class === "place" && MAJOR_TYPES.includes(r.type ?? "")),
        isPlace: isAdmin || (r.class === "place" && PLACE_TYPES.includes(r.type ?? "")),
      };
    });
  },
};

/**
 * The provider in use.
 *
 * Registered by id so adding one is a line here plus a file, and choosing one
 * is an env var rather than a deploy. An unknown id falls back rather than
 * throwing: a typo in configuration should not leave the driver with no search
 * at all.
 */
const PROVIDERS: Record<string, PlacesProvider> = {
  [NominatimProvider.id]: NominatimProvider,
};

export function activeProvider(): PlacesProvider {
  const wanted = (import.meta.env.VITE_PLACES_PROVIDER as string) || NominatimProvider.id;
  return PROVIDERS[wanted] ?? NominatimProvider;
}

/** Search and rank in one call — what the UI actually wants. */
export async function searchPlaces(
  query: string,
  near: Near,
  signal?: AbortSignal,
): Promise<PlaceHit[]> {
  const raw = await activeProvider().search(query, near, signal);
  return rankHits(raw, query, near);
}
