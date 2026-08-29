import type { Lang } from "./index";
import { countryFromTimeZone } from "../config/geo";

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
  // Euro-zone — every member state, so a driver anywhere in it sees euros.
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", BE: "EUR", AT: "EUR",
  IE: "EUR", PT: "EUR", GR: "EUR", FI: "EUR", HR: "EUR", SK: "EUR", SI: "EUR",
  LT: "EUR", LV: "EUR", EE: "EUR", CY: "EUR", MT: "EUR", LU: "EUR",
  // Officially dollarised — USD is the actual currency in the driver's hand.
  EC: "USD", SV: "USD", PA: "USD",
  // Spanish-speaking Latin America, in the money the driver is actually paid in.
  AR: "ARS", CO: "COP", CL: "CLP", PE: "PEN",

  /* The remaining thirty-four of the seventy-two countries the app covers.
     Every one of these previously fell through to the USD default, which is the
     quiet kind of wrong: a driver in Copenhagen saw "$12.40" for a day that
     earned 12.40 kroner, and nothing on screen said the app had guessed. */
  // Nordics and central Europe, outside the euro
  DK: "DKK", SE: "SEK", NO: "NOK", PL: "PLN", CZ: "CZK", RO: "RON", CH: "CHF",
  // Eastern Europe and central Asia
  TR: "TRY", RU: "RUB", UA: "UAH", KZ: "KZT",
  // Middle East and North Africa. AE and SA were already here.
  IL: "ILS", EG: "EGP", MA: "MAD", QA: "QAR", KW: "KWD", BH: "BHD",
  OM: "OMR", JO: "JOD", LB: "LBP",
  // Sub-Saharan Africa. NG and ZA were already here.
  KE: "KES", TZ: "TZS", UG: "UGX", GH: "GHS",
  // Asia-Pacific
  HK: "HKD", TW: "TWD", NZ: "NZD", LK: "LKR", NP: "NPR", KH: "KHR", MM: "MMK",
  // Latin America not on the dollar
  CR: "CRC", DO: "DOP", UY: "UYU",
};

// Country → app UI language. Falls through to the device UI language, then English.
const COUNTRY_LANG: Record<string, Lang> = {
  PH: "fil",
  IN: "hi",
  BD: "bn",
  // Urdu, now that the app has it. Pakistan was previously reading through to
  // the device language and landing on English for most handsets.
  PK: "ur",
  // The rest of the launch map, so every target country resolves to a
  // dictionary rather than to English.
  NL: "nl", IT: "it", GR: "el", CY: "el", FI: "fi",
  PL: "pl", RO: "ro", MD: "ro", CZ: "cs", SE: "sv", DK: "da", NO: "nb", TR: "tr",
  RU: "ru", KZ: "ru", BY: "ru", UA: "uk", IL: "he",
  KE: "sw", TZ: "sw", UG: "sw",
  KH: "km", MM: "my", LK: "si", NP: "ne",
  // BE stays French below. Belgium is majority Dutch-speaking, but the device
  // language is consulted BEFORE this map, so a Flemish handset already gets
  // Dutch — this only decides the fallback for an English phone in Brussels,
  // where French is the safer guess.
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
  // Lebanon was falling through to English. Same reasoning as the rest of the
  // region; a Lebanese handset already gets Arabic from the device language,
  // this decides the fallback for an English one.
  LB: "ar",
  // Switzerland was falling through to English too. German is the largest of
  // its four, and the device language is consulted first, so a French or
  // Italian handset in Geneva or Lugano is already served before this line.
  CH: "de",
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
  // Returns "" rather than a country. It used to answer "PH" when it had no
  // idea, which is indistinguishable from actually detecting the Philippines —
  // so every caller downstream treated a total absence of information as a
  // confident answer. An empty string lets them fall back on their own terms.
  return "";
}

/**
 * The device's country, asking every signal it has before giving up.
 *
 * detectCountry() reads the locale's region, which a phone set to plain "en"
 * simply does not carry — common on the cheap Android handsets most of this
 * app's drivers use. The timezone almost always survives where the locale does
 * not, so it is asked second.
 *
 * Use this rather than detectCountry() anywhere a missing answer would be
 * papered over with a guess.
 */
export function resolveCountry(): string {
  return detectCountry() || countryFromTimeZone();
}

/**
 * The device's country when the question is WHERE IT IS, rather than what
 * language it prefers — timezone first, locale second.
 *
 * The two signals disagree more often than they look like they should. A
 * driver in Mumbai on an English handset reports locale en-US and timezone
 * Asia/Calcutta: the locale answers "what language do I read", and reading
 * that as a position drops the map in New York. The timezone is set by where
 * the phone actually is, so for a map centre it is the better of the two.
 *
 * The reverse is true for currency, language and which work apps to list —
 * those follow what the driver chose, so they use resolveCountry().
 */
export function resolveCountryForLocation(): string {
  return countryFromTimeZone() || detectCountry();
}

export function countryToCurrency(country: string): string {
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? "USD";
}

const LANG_PREFIX: Record<string, Lang> = {
  es: "es", fil: "fil", tl: "fil", hi: "hi", bn: "bn", id: "id", ms: "ms", th: "th",
  vi: "vi", pt: "pt", fr: "fr", de: "de", zh: "zh", ja: "ja", ko: "ko", ar: "ar",
  // India's other languages, and Urdu. `pa` covers pa-IN and pa-PK alike; both
  // are Punjabi, and the driver can switch script by picking another language.
  ta: "ta", te: "te", mr: "mr", kn: "kn", ml: "ml", gu: "gu", pa: "pa", ur: "ur",
  nl: "nl", it: "it", pl: "pl", ro: "ro", cs: "cs", sv: "sv", da: "da", nb: "nb", no: "nb", fi: "fi", el: "el", tr: "tr", ru: "ru", uk: "uk", he: "he", sw: "sw", km: "km", my: "my", si: "si", ne: "ne",
};

/** The device UI language, if it is one the app speaks. */
function deviceLang(): Lang | null {
  const lang = (navigator.language || "").toLowerCase();
  for (const prefix of Object.keys(LANG_PREFIX)) {
    if (lang.startsWith(prefix)) return LANG_PREFIX[prefix];
  }
  return null;
}

export function countryToLang(country: string): Lang {
  const cc = country.toUpperCase();

  // The DEVICE language wins over the country default — but only when it is a
  // language other than English.
  //
  // This ordering exists for India. The country map can only name one language
  // per country, and for a country with twenty-two of them that is a guess:
  // a phone set to ta-IN was answered "hi" because IN → hi was consulted first
  // and the driver's own setting was never read at all. Their phone already
  // says what they read; the country map is for when it does not.
  //
  // English is excluded deliberately, because it is the default a cheap handset
  // ships with rather than a choice anyone made. Reading en-PH as "this driver
  // wants English" would have taken Filipino away from the launched market.
  const device = deviceLang();
  if (device && device !== "en") return device;

  if (COUNTRY_LANG[cc]) return COUNTRY_LANG[cc];
  return device ?? "en";
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
