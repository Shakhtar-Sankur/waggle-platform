export interface CurrencyOption {
  code: string;
  symbol: string;
  label: string;
  locale: string;
}

// Currencies the driver can display their earnings in (global-ready).
export const CURRENCIES: CurrencyOption[] = [
  { code: "PHP", symbol: "₱", label: "Philippine Peso", locale: "en-PH" },
  { code: "USD", symbol: "$", label: "US Dollar", locale: "en-US" },
  { code: "EUR", symbol: "€", label: "Euro", locale: "de-DE" },
  { code: "GBP", symbol: "£", label: "British Pound", locale: "en-GB" },
  { code: "INR", symbol: "₹", label: "Indian Rupee", locale: "en-IN" },
  { code: "IDR", symbol: "Rp", label: "Indonesian Rupiah", locale: "id-ID" },
  { code: "MYR", symbol: "RM", label: "Malaysian Ringgit", locale: "ms-MY" },
  { code: "THB", symbol: "฿", label: "Thai Baht", locale: "th-TH" },
  { code: "VND", symbol: "₫", label: "Vietnamese Dong", locale: "vi-VN" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar", locale: "en-SG" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham", locale: "ar-AE" },
  { code: "SAR", symbol: "﷼", label: "Saudi Riyal", locale: "ar-SA" },
  { code: "NGN", symbol: "₦", label: "Nigerian Naira", locale: "en-NG" },
  { code: "ZAR", symbol: "R", label: "South African Rand", locale: "en-ZA" },
  { code: "BRL", symbol: "R$", label: "Brazilian Real", locale: "pt-BR" },
  { code: "MXN", symbol: "$", label: "Mexican Peso", locale: "es-MX" },
  { code: "JPY", symbol: "¥", label: "Japanese Yen", locale: "ja-JP" },
  { code: "CNY", symbol: "¥", label: "Chinese Yuan", locale: "zh-CN" },
  { code: "KRW", symbol: "₩", label: "South Korean Won", locale: "ko-KR" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar", locale: "en-AU" },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar", locale: "en-CA" },
  { code: "PKR", symbol: "₨", label: "Pakistani Rupee", locale: "en-PK" },
  { code: "BDT", symbol: "৳", label: "Bangladeshi Taka", locale: "bn-BD" },
];

let activeCurrency: CurrencyOption = CURRENCIES[0];

/**
 * A sensible STARTING per-kilometre rate for each currency.
 *
 * The app used to default every driver to "10", which is fine as ₱10/km or
 * ₹10/km but nonsense as $10/km (~$16 a mile) — a new driver in the US or EU
 * would drive 20 km and be told they earned $200. Earnings is the headline
 * number, so a wrong default destroys trust on day one.
 *
 * These are rough gross per-km figures meant only as a starting point; the
 * driver sets their real rate in Settings.
 */
const DEFAULT_RATE_PER_KM: Record<string, number> = {
  PHP: 10, INR: 10, IDR: 3000, VND: 8000, PKR: 40, BDT: 30, NGN: 500,
  KRW: 800, JPY: 100, THB: 6, MXN: 8, ZAR: 6, CNY: 2.5, BRL: 2,
  MYR: 1.2, AED: 1.5, SAR: 1.5, AUD: 1, CAD: 0.9, SGD: 0.8,
  USD: 0.7, EUR: 0.65, GBP: 0.6,
};

export function defaultRateFor(code: string): number {
  return DEFAULT_RATE_PER_KM[code] ?? 1;
}

/** Round to a human-looking goal figure (250, 3,000, 900,000 …). */
function niceRound(value: number): number {
  if (value <= 0) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(value)));
  const step = value / mag >= 5 ? mag : mag / 2;
  return Math.max(step, Math.round(value / step) * step);
}

/**
 * A believable DAILY earnings goal for this currency.
 *
 * Derived from the per-km rate so it stays achievable everywhere: the old flat
 * 500 meant ₱500/day (fine) but also $500/day, which at $0.70/km needs 714 km
 * in one day — the goal ring would sit near zero forever for a US driver.
 * ~60 km of driving is a normal shift.
 */
export function defaultDailyGoalFor(code: string): number {
  return niceRound(defaultRateFor(code) * 60);
}

/** Weekly goal = six working days of the daily goal. */
export function weeklyGoalFrom(dailyGoal: number): number {
  return niceRound(dailyGoal * 6);
}

export function setCurrency(code: string) {
  activeCurrency = CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}

export function currency(value: number) {
  return `${activeCurrency.symbol}${Math.round(value).toLocaleString(activeCurrency.locale)}`;
}

/**
 * Like `currency`, but keeps decimals for small amounts.
 *
 * Totals ("$1,240 earned") read best rounded, but a per-km RATE of 0.7 rounded
 * to "$1" is simply wrong — and in USD/EUR/GBP every realistic rate is under 1.
 * So: show up to 2 decimals below 10, round above it.
 */
export function currencyPrecise(value: number) {
  // Money convention: a sub-unit amount shows BOTH decimals — "$0.10", never
  // "$0.1". Exactly zero stays "$0" rather than a noisy "$0.00", and anything
  // from 10 up is rounded (₹600, ₱1,500 read better without decimals).
  const small = Math.abs(value) < 10 && value !== 0;
  const n = value.toLocaleString(activeCurrency.locale, {
    minimumFractionDigits: small ? 2 : 0,
    maximumFractionDigits: small ? 2 : 0,
  });
  return `${activeCurrency.symbol}${n}`;
}

export function km(value: number) {
  return `${value.toFixed(1)} km`;
}

export function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// Language-neutral relative time ("5m", "3h", "2d") so it reads in every locale.
export function timeAgo(timestamp: number) {
  const delta = Date.now() - timestamp;
  const minutes = Math.max(1, Math.floor(delta / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}
