import type { WorkApp } from "../types";

export const APP_NAME = "Buzz";

/**
 * The company behind the app.
 *
 * Buzz shipped without naming its maker anywhere — not on the auth screen,
 * not in the profile, and not in the privacy policy, which is a contract that
 * has to say who the other party is. A driver handing over their location is
 * entitled to know whose company holds it.
 */
export const COMPANY_NAME = "Gigzen Private Limited";
export const COMPANY_SHORT = "Gigzen";
export const COMPANY_LOCATION = "Bhubaneswar, India";
export const COMPANY_SITE = "https://shakhtar-sankur.github.io/gigzen/";

/**
 * Contact addresses on the legal pages.
 *
 * These used to be support@ and privacy@masayaako.app — a domain from the app's
 * old name that has never been registered and does not resolve. A privacy policy
 * whose contact address bounces fails Play Store review and, in a GDPR market,
 * fails the law. Point them somewhere that receives mail; move them to a company
 * domain once one exists.
 */
export const SUPPORT_EMAIL = "sankur.kundu.tw@gmail.com";
export const PRIVACY_EMAIL = "sankur.kundu.tw@gmail.com";

export const MANILA_CENTER = {
  lat: 14.5995,
  lng: 120.9842,
};

// Platforms a driver can be working for. `regions` lets the picker surface the
// ones that actually operate where the driver is, before everything else.
// Adding a new platform here needs NO database change — the old CHECK
// constraint on active_app was dropped in supabase/work_apps_global.sql.
export const WORK_APPS: WorkApp[] = [
  // --- Philippines / South-East Asia ---
  { id: "grab", name: "Grab", logo: "🟢", color: "#20c773", regions: ["PH", "ID", "MY", "SG", "TH", "VN", "KH", "MM"] },
  { id: "angkas", name: "Angkas", logo: "🏍️", color: "#1264ff", regions: ["PH"] },
  { id: "joyride", name: "JoyRide", logo: "🛵", color: "#ff396c", regions: ["PH"] },
  { id: "moveit", name: "MoveIt", logo: "🚚", color: "#a9734b", regions: ["PH"] },
  { id: "foodpanda", name: "foodpanda", logo: "🐼", color: "#e82176", regions: ["PH", "TH", "MY", "SG", "BD", "PK", "HK", "TW"] },
  { id: "gojek", name: "Gojek", logo: "🟩", color: "#00aa13", regions: ["ID", "SG", "VN"] },
  { id: "lalamove", name: "Lalamove", logo: "🧡", color: "#f16622", regions: ["PH", "SG", "MY", "TH", "VN", "HK", "TW", "BR", "MX", "IN"] },
  { id: "shopeefood", name: "ShopeeFood", logo: "🍜", color: "#ee4d2d", regions: ["ID", "VN", "TH", "PH", "MY"] },
  { id: "maxim", name: "Maxim", logo: "🚙", color: "#ffd400", regions: ["ID", "PH", "MY", "RU", "NG"] },

  // --- India ---
  { id: "ola", name: "Ola", logo: "🚕", color: "#7ac143", regions: ["IN", "AU", "GB"] },
  { id: "rapido", name: "Rapido", logo: "🛺", color: "#f6c700", regions: ["IN"] },
  { id: "swiggy", name: "Swiggy", logo: "🧡", color: "#fc8019", regions: ["IN"] },
  { id: "zomato", name: "Zomato", logo: "🍽️", color: "#e23744", regions: ["IN", "AE"] },
  { id: "blinkit", name: "Blinkit", logo: "🛒", color: "#f8cb46", regions: ["IN"] },
  { id: "zepto", name: "Zepto", logo: "🏪", color: "#5f2eea", regions: ["IN"] },
  { id: "bigbasket", name: "BigBasket", logo: "🥦", color: "#84c225", regions: ["IN"] },
  { id: "dunzo", name: "Dunzo", logo: "🏃", color: "#00d290", regions: ["IN"] },
  { id: "porter", name: "Porter", logo: "🚛", color: "#f9a825", regions: ["IN"] },
  { id: "flipkart", name: "Flipkart", logo: "🛍️", color: "#2874f0", regions: ["IN"] },

  // --- Global / West / Middle East ---
  { id: "uber", name: "Uber", logo: "🚖", color: "#000000", regions: ["IN", "US", "GB", "BR", "MX", "ZA", "AU", "CA", "FR", "DE", "ES", "PT", "AE", "SA", "NG", "JP"] },
  { id: "ubereats", name: "Uber Eats", logo: "🍔", color: "#06c167", regions: ["US", "GB", "CA", "AU", "FR", "DE", "ES", "PT", "BR", "MX", "JP", "IN", "AE"] },
  { id: "amazon", name: "Amazon Flex", logo: "📦", color: "#ff9900", regions: ["IN", "US", "GB", "DE", "FR", "ES", "CA", "AU", "JP", "MX", "BR"] },
  { id: "doordash", name: "DoorDash", logo: "🚪", color: "#ff3008", regions: ["US", "CA", "AU", "NZ", "JP"] },
  { id: "deliveroo", name: "Deliveroo", logo: "🦘", color: "#00ccbc", regions: ["GB", "FR", "IT", "ES", "AE", "SG", "HK", "BE", "IE"] },
  { id: "bolt", name: "Bolt", logo: "⚡", color: "#34d186", regions: ["ZA", "NG", "GB", "DE", "FR", "PT", "PL", "KE", "RO"] },
  { id: "indrive", name: "inDrive", logo: "🤝", color: "#c1f11d", regions: ["ID", "PH", "MX", "BR", "ZA", "NG", "PK", "EG", "KZ", "IN"] },
  { id: "glovo", name: "Glovo", logo: "🛍️", color: "#ffc244", regions: ["ES", "IT", "PT", "PL", "RO", "MA", "EG", "NG", "KE", "UA"] },
  { id: "wolt", name: "Wolt", logo: "🔵", color: "#00c2e8", regions: ["FI", "DE", "SE", "NO", "DK", "PL", "GR", "IL", "JP"] },
  { id: "justeat", name: "Just Eat", logo: "🍕", color: "#ff8000", regions: ["GB", "DE", "FR", "ES", "IT", "NL", "IE", "CA", "AU"] },
  { id: "rappi", name: "Rappi", logo: "🧃", color: "#fe3465", regions: ["BR", "MX", "CO", "AR", "CL", "PE", "EC", "CR", "UY"] },
  { id: "careem", name: "Careem", logo: "🐪", color: "#3bb54a", regions: ["AE", "SA", "EG", "PK", "JO", "QA", "KW", "MA"] },
  { id: "talabat", name: "Talabat", logo: "🍗", color: "#ff5a00", regions: ["AE", "SA", "KW", "QA", "BH", "OM", "EG", "JO"] },
  { id: "instacart", name: "Instacart", logo: "🥕", color: "#43b02a", regions: ["US", "CA"] },

  { id: "others", name: "Others", logo: "🚗", color: "#475569" },
];

