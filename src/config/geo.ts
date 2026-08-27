/**
 * Where to put the map when the device will not say where it is.
 *
 * Every unknown position used to become Manila. That is correct for exactly
 * one country and wrong for the rest: a driver in Delhi who declines the
 * location prompt, or whose first GPS fix has not landed, opened the map on
 * another continent. The app ships to drivers on Uber, Rappi, Careem, Bolt and
 * Glovo — it was never a Philippines-only product, but its fallback was.
 *
 * These are a populous city per country rather than the geometric centre: a
 * country's centroid is usually farmland, and a driver is not in farmland. The
 * point is only ever a starting view — it is flagged `fallback: true` so no
 * caller mistakes it for a real fix, and the first genuine GPS reading
 * replaces it.
 */
export const COUNTRY_CENTER: Record<string, { lat: number; lng: number }> = {
  // South & South-East Asia
  PH: { lat: 14.5995, lng: 120.9842 }, // Manila
  IN: { lat: 19.076, lng: 72.8777 }, // Mumbai
  ID: { lat: -6.2088, lng: 106.8456 }, // Jakarta
  MY: { lat: 3.139, lng: 101.6869 }, // Kuala Lumpur
  SG: { lat: 1.3521, lng: 103.8198 },
  TH: { lat: 13.7563, lng: 100.5018 }, // Bangkok
  VN: { lat: 10.8231, lng: 106.6297 }, // Ho Chi Minh City
  BD: { lat: 23.8103, lng: 90.4125 }, // Dhaka
  PK: { lat: 24.8607, lng: 67.0011 }, // Karachi
  LK: { lat: 6.9271, lng: 79.8612 }, // Colombo
  NP: { lat: 27.7172, lng: 85.324 }, // Kathmandu
  KH: { lat: 11.5564, lng: 104.9282 }, // Phnom Penh
  MM: { lat: 16.8409, lng: 96.1735 }, // Yangon

  // East Asia
  JP: { lat: 35.6762, lng: 139.6503 }, // Tokyo
  KR: { lat: 37.5665, lng: 126.978 }, // Seoul
  CN: { lat: 31.2304, lng: 121.4737 }, // Shanghai
  TW: { lat: 25.033, lng: 121.5654 }, // Taipei
  HK: { lat: 22.3193, lng: 114.1694 },

  // Middle East
  AE: { lat: 25.2048, lng: 55.2708 }, // Dubai
  SA: { lat: 24.7136, lng: 46.6753 }, // Riyadh
  QA: { lat: 25.2854, lng: 51.531 }, // Doha
  KW: { lat: 29.3759, lng: 47.9774 },
  BH: { lat: 26.2285, lng: 50.586 },
  OM: { lat: 23.588, lng: 58.3829 }, // Muscat
  JO: { lat: 31.9454, lng: 35.9284 }, // Amman
  LB: { lat: 33.8938, lng: 35.5018 }, // Beirut
  TR: { lat: 41.0082, lng: 28.9784 }, // Istanbul
  IL: { lat: 32.0853, lng: 34.7818 }, // Tel Aviv

  // Africa
  EG: { lat: 30.0444, lng: 31.2357 }, // Cairo
  NG: { lat: 6.5244, lng: 3.3792 }, // Lagos
  KE: { lat: -1.2921, lng: 36.8219 }, // Nairobi
  ZA: { lat: -26.2041, lng: 28.0473 }, // Johannesburg
  GH: { lat: 5.6037, lng: -0.187 }, // Accra
  TZ: { lat: -6.7924, lng: 39.2083 }, // Dar es Salaam
  UG: { lat: 0.3476, lng: 32.5825 }, // Kampala
  MA: { lat: 33.5731, lng: -7.5898 }, // Casablanca

  // Europe
  GB: { lat: 51.5074, lng: -0.1278 }, // London
  IE: { lat: 53.3498, lng: -6.2603 }, // Dublin
  FR: { lat: 48.8566, lng: 2.3522 }, // Paris
  DE: { lat: 52.52, lng: 13.405 }, // Berlin
  ES: { lat: 40.4168, lng: -3.7038 }, // Madrid
  PT: { lat: 38.7223, lng: -9.1393 }, // Lisbon
  IT: { lat: 41.9028, lng: 12.4964 }, // Rome
  NL: { lat: 52.3676, lng: 4.9041 }, // Amsterdam
  BE: { lat: 50.8503, lng: 4.3517 }, // Brussels
  PL: { lat: 52.2297, lng: 21.0122 }, // Warsaw
  SE: { lat: 59.3293, lng: 18.0686 }, // Stockholm
  NO: { lat: 59.9139, lng: 10.7522 }, // Oslo
  DK: { lat: 55.6761, lng: 12.5683 }, // Copenhagen
  FI: { lat: 60.1699, lng: 24.9384 }, // Helsinki
  CH: { lat: 47.3769, lng: 8.5417 }, // Zurich
  AT: { lat: 48.2082, lng: 16.3738 }, // Vienna
  CZ: { lat: 50.0755, lng: 14.4378 }, // Prague
  RO: { lat: 44.4268, lng: 26.1025 }, // Bucharest
  GR: { lat: 37.9838, lng: 23.7275 }, // Athens
  UA: { lat: 50.4501, lng: 30.5234 }, // Kyiv
  RU: { lat: 55.7558, lng: 37.6173 }, // Moscow

  // Americas
  US: { lat: 40.7128, lng: -74.006 }, // New York
  CA: { lat: 43.6532, lng: -79.3832 }, // Toronto
  MX: { lat: 19.4326, lng: -99.1332 }, // Mexico City
  BR: { lat: -23.5505, lng: -46.6333 }, // Sao Paulo
  AR: { lat: -34.6037, lng: -58.3816 }, // Buenos Aires
  CO: { lat: 4.711, lng: -74.0721 }, // Bogota
  CL: { lat: -33.4489, lng: -70.6693 }, // Santiago
  PE: { lat: -12.0464, lng: -77.0428 }, // Lima
  EC: { lat: -0.1807, lng: -78.4678 }, // Quito
  CR: { lat: 9.9281, lng: -84.0907 }, // San Jose
  DO: { lat: 18.4861, lng: -69.9312 }, // Santo Domingo

  // Oceania
  AU: { lat: -33.8688, lng: 151.2093 }, // Sydney
  NZ: { lat: -36.8485, lng: 174.7633 }, // Auckland
};

/**
 * A coarse timezone → country map, used only when the browser locale gives no
 * region. A phone set to plain "en" says nothing about where it is, and that is
 * common on cheap Android handsets — which is most of this app's market.
 *
 * Deliberately short: it covers the zones for the countries above rather than
 * every zone on earth, because a wrong guess and no guess cost the same here
 * (both end at the default) and a 400-entry table would not earn its bytes.
 */
const ZONE_COUNTRY: Record<string, string> = {
  "Asia/Manila": "PH",
  "Asia/Kolkata": "IN", "Asia/Calcutta": "IN",
  "Asia/Jakarta": "ID", "Asia/Makassar": "ID",
  "Asia/Kuala_Lumpur": "MY", "Asia/Singapore": "SG",
  "Asia/Bangkok": "TH", "Asia/Ho_Chi_Minh": "VN", "Asia/Saigon": "VN",
  "Asia/Dhaka": "BD", "Asia/Karachi": "PK", "Asia/Colombo": "LK",
  "Asia/Kathmandu": "NP", "Asia/Phnom_Penh": "KH", "Asia/Yangon": "MM",
  "Asia/Tokyo": "JP", "Asia/Seoul": "KR", "Asia/Shanghai": "CN",
  "Asia/Taipei": "TW", "Asia/Hong_Kong": "HK",
  "Asia/Dubai": "AE", "Asia/Riyadh": "SA", "Asia/Qatar": "QA",
  "Asia/Kuwait": "KW", "Asia/Bahrain": "BH", "Asia/Muscat": "OM",
  "Asia/Amman": "JO", "Asia/Beirut": "LB", "Europe/Istanbul": "TR",
  "Asia/Jerusalem": "IL", "Asia/Tel_Aviv": "IL",
  "Africa/Cairo": "EG", "Africa/Lagos": "NG", "Africa/Nairobi": "KE",
  "Africa/Johannesburg": "ZA", "Africa/Accra": "GH",
  "Africa/Dar_es_Salaam": "TZ", "Africa/Kampala": "UG", "Africa/Casablanca": "MA",
  "Europe/London": "GB", "Europe/Dublin": "IE", "Europe/Paris": "FR",
  "Europe/Berlin": "DE", "Europe/Madrid": "ES", "Europe/Lisbon": "PT",
  "Europe/Rome": "IT", "Europe/Amsterdam": "NL", "Europe/Brussels": "BE",
  "Europe/Warsaw": "PL", "Europe/Stockholm": "SE", "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK", "Europe/Helsinki": "FI", "Europe/Zurich": "CH",
  "Europe/Vienna": "AT", "Europe/Prague": "CZ", "Europe/Bucharest": "RO",
  "Europe/Athens": "GR", "Europe/Kiev": "UA", "Europe/Kyiv": "UA",
  "Europe/Moscow": "RU",
  "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US",
  "America/Los_Angeles": "US", "America/Phoenix": "US",
  "America/Toronto": "CA", "America/Vancouver": "CA",
  "America/Mexico_City": "MX", "America/Sao_Paulo": "BR",
  "America/Argentina/Buenos_Aires": "AR", "America/Bogota": "CO",
  "America/Santiago": "CL", "America/Lima": "PE", "America/Guayaquil": "EC",
  "America/Costa_Rica": "CR", "America/Santo_Domingo": "DO",
  "Australia/Sydney": "AU", "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU", "Australia/Perth": "AU",
  "Pacific/Auckland": "NZ",
};

/** The country implied by the device's timezone, or "" if it is not one we map. */
export function countryFromTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return ZONE_COUNTRY[zone] ?? "";
  } catch {
    return "";
  }
}

/**
 * Where to open the map before there is a real fix.
 *
 * Overridable with VITE_DEFAULT_CENTER ("lat,lng") for a build aimed at one
 * market. Without it, and with nothing to go on, this lands on Manila — but as
 * the LAST resort rather than the first assumption, which is the whole
 * difference from what it replaced.
 */
export function defaultCenterFor(country: string): { lat: number; lng: number } {
  const known = COUNTRY_CENTER[country?.toUpperCase()];
  if (known) return known;

  const configured = import.meta.env.VITE_DEFAULT_CENTER as string | undefined;
  if (configured) {
    const [lat, lng] = configured.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return COUNTRY_CENTER.PH;
}
