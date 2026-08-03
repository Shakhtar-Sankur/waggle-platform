import type { Lang } from "./index";

// Country (ISO-3166 alpha-2) → currency code (must exist in CURRENCIES; else falls back to USD).
const COUNTRY_CURRENCY: Record<string, string> = {
  PH: "PHP",
  US: "USD",
  IN: "INR",
  GB: "GBP",
  ID: "IDR",
  MY: "MYR",
  TH: "THB",
  VN: "VND",
  SG: "SGD",
  AE: "AED",
  SA: "SAR",
  NG: "NGN",
  ZA: "ZAR",
  BR: "BRL",
  MX: "MXN",
  JP: "JPY",
  CN: "CNY",
  KR: "KRW",
  AU: "AUD",
  CA: "CAD",
  PK: "PKR",
  BD: "BDT",
  // Euro-zone
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR",
  IE: "EUR", PT: "EUR", GR: "EUR", FI: "EUR",
  // Spanish-speaking Latin America default to USD display
  AR: "USD", CO: "USD", CL: "USD", PE: "USD",
};

// Country → app UI language. Falls through to the device UI language, then English.
const COUNTRY_LANG: Record<string, Lang> = {
  PH: "fil",
  IN: "hi",
  BD: "bn",
  ID: "id",
  MY: "ms",
  TH: "th",
  VN: "vi",
  BR: "pt", PT: "pt",
  FR: "fr", BE: "fr",
  DE: "de", AT: "de",
  CN: "zh", TW: "zh", HK: "zh", SG: "zh",
  JP: "ja",
  KR: "ko",
  AE: "ar", SA: "ar", EG: "ar", QA: "ar", KW: "ar", BH: "ar", OM: "ar", JO: "ar", MA: "ar", DZ: "ar",
  ES: "es", MX: "es", AR: "es", CO: "es", CL: "es", PE: "es", VE: "es", EC: "es", GT: "es", BO: "es", DO: "es", HN: "es", PY: "es", SV: "es", NI: "es", CR: "es", PA: "es", UY: "es",
};

export function detectCountry(): string {
  try {
    const locale = navigator.language || navigator.languages?.[0] || "en-US";
    const region = new Intl.Locale(locale).maximize().region;
    if (region) return region.toUpperCase();
    const parts = locale.split("-");
    if (parts[1]) return parts[1].toUpperCase();
  } catch {
    /* ignore */
  }
  return "PH";
}

export function countryToCurrency(country: string): string {
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? "USD";
}

const LANG_PREFIX: Record<string, Lang> = {
  es: "es", fil: "fil", tl: "fil", hi: "hi", bn: "bn", id: "id", ms: "ms", th: "th",
  vi: "vi", pt: "pt", fr: "fr", de: "de", zh: "zh", ja: "ja", ko: "ko", ar: "ar",
};

export function countryToLang(country: string): Lang {
  const cc = country.toUpperCase();
  if (COUNTRY_LANG[cc]) return COUNTRY_LANG[cc];
  // Fall back to the device UI language when the country isn't mapped.
  const lang = (navigator.language || "en").toLowerCase();
  for (const prefix of Object.keys(LANG_PREFIX)) {
    if (lang.startsWith(prefix)) return LANG_PREFIX[prefix];
  }
  return "en";
}

// Optional GPS refinement: turn coordinates into a country code via a free,
// key-less reverse-geocoder. Best-effort — resolves null on any failure.
export async function reverseGeocodeCountry(lat: number, lng: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.countryCode === "string" ? data.countryCode.toUpperCase() : null;
  } catch {
    return null;
  }
}
