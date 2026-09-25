import { supabase } from "../services/SupabaseService";

/**
 * Waggle Business talking to the database. Every rule that matters lives in
 * supabase/business.sql and business_v2.sql, not here: a business cannot verify
 * itself, set a fare, change its plan without being billed, write its own
 * charges or invoices, confirm its own payment, or touch a job once a worker
 * has taken it. This file only asks; the database decides.
 */

export type BusinessKind =
  | "restaurant" | "cafe" | "cloud_kitchen" | "bakery"
  | "grocery" | "fruits_veg" | "meat_fish" | "dairy"
  | "pharmacy"
  | "electronics" | "fashion" | "home_kitchen" | "books" | "beauty" | "toys" | "pets" | "flowers_gifts" | "hardware"
  | "other";
export type BusinessStatus = "pending" | "verified" | "rejected" | "suspended";
export type BusinessPlan = "starter" | "growth" | "pro";
export type EntityType = "proprietor" | "partnership" | "llp" | "private_ltd" | "public_ltd" | "trust" | "other";
export type DocKind = "pan" | "aadhaar" | "selfie" | "shopfront" | "fssai" | "drug_licence" | "proof";
export type ProofType = "gst" | "establishment" | "trade_licence" | "udyam";
export type Diet = "veg" | "non_veg" | "egg";

/** A group of choices on an item: "Size" (Half / Full), "Add-ons", … Prices are what each choice adds. */
export interface OptionGroup {
  name: string;
  required: boolean;
  max: number;
  choices: { name: string; price_paise: number }[];
}
/** Which choices were picked: [group index, choice index] pairs. */
export type Selection = [number, number][];
export interface ChosenOption { group: string; choice: string; price_paise: number }

/** Price of one unit with these choices, the same sum the database makes. */
export function unitPrice(basePaise: number, groups: OptionGroup[] | null, selection: Selection): number {
  return selection.reduce((sum, [g, c]) => sum + (groups?.[g]?.choices[c]?.price_paise ?? 0), basePaise);
}

export interface Offer {
  code: string;
  title: string;
  kind: "percent" | "flat";
  value: number;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  firstOrderOnly: boolean;
}

/** What an offer takes off a subtotal, by the same rule the database applies. */
export function offerDiscount(offer: Offer, subtotalPaise: number): number {
  if (subtotalPaise < offer.minOrderPaise) return 0;
  return offer.kind === "percent"
    ? Math.min(Math.floor((subtotalPaise * offer.value) / 100), offer.maxDiscountPaise ?? subtotalPaise)
    : Math.min(offer.value, subtotalPaise);
}

export interface Coupon extends Offer {
  id: string;
  perPhoneLimit: number;
  usageLimit: number | null;
  startsAt: string;
  endsAt: string | null;
  active: boolean;
}
export type ItemTag = "bestseller" | "chefs_special" | "new";

/** Every kind of shop, in the groups the registration screen shows them in. */
export const CATEGORY_GROUPS: { group: "food" | "grocery" | "health" | "retail" | "other"; kinds: BusinessKind[] }[] = [
  { group: "food", kinds: ["restaurant", "cafe", "cloud_kitchen", "bakery"] },
  { group: "grocery", kinds: ["grocery", "fruits_veg", "meat_fish", "dairy"] },
  { group: "health", kinds: ["pharmacy"] },
  { group: "retail", kinds: ["electronics", "fashion", "home_kitchen", "books", "beauty", "toys", "pets", "flowers_gifts", "hardware"] },
  { group: "other", kinds: ["other"] },
];

/** The licence the law asks of each category; the same rule as kind_licence() in the database. */
export function licenceFor(kind: BusinessKind): "fssai" | "drug" | null {
  if (["restaurant", "cafe", "cloud_kitchen", "bakery", "grocery", "fruits_veg", "meat_fish", "dairy"].includes(kind)) return "fssai";
  if (kind === "pharmacy") return "drug";
  return null;
}

/** GST state codes, for the place of supply on invoices. */
export const STATES: [string, string][] = [
  ["35", "Andaman & Nicobar"], ["37", "Andhra Pradesh"], ["12", "Arunachal Pradesh"], ["18", "Assam"], ["10", "Bihar"],
  ["04", "Chandigarh"], ["22", "Chhattisgarh"], ["26", "Dadra & Nagar Haveli and Daman & Diu"], ["07", "Delhi"], ["30", "Goa"],
  ["24", "Gujarat"], ["06", "Haryana"], ["02", "Himachal Pradesh"], ["01", "Jammu & Kashmir"], ["20", "Jharkhand"],
  ["29", "Karnataka"], ["32", "Kerala"], ["38", "Ladakh"], ["31", "Lakshadweep"], ["23", "Madhya Pradesh"],
  ["27", "Maharashtra"], ["14", "Manipur"], ["17", "Meghalaya"], ["15", "Mizoram"], ["13", "Nagaland"],
  ["21", "Odisha"], ["34", "Puducherry"], ["03", "Punjab"], ["08", "Rajasthan"], ["11", "Sikkim"],
  ["33", "Tamil Nadu"], ["36", "Telangana"], ["16", "Tripura"], ["09", "Uttar Pradesh"], ["05", "Uttarakhand"], ["19", "West Bengal"],
];
export const stateName = (code: string | null | undefined) => STATES.find(([c]) => c === code)?.[1] ?? code ?? "";

export interface Business {
  id: string;
  ownerId: string;
  name: string;
  kind: BusinessKind;
  phone: string | null;
  address: string;
  lat: number;
  lng: number;
  gstin: string | null;
  fssai: string | null;
  status: BusinessStatus;
  plan: BusinessPlan;
  reviewNote: string | null;
  createdAt: string;
  entityType: EntityType | null;
  ownerName: string | null;
  pan: string | null;
  aadhaarLast4: string | null;
  stateCode: string | null;
  drugLicence: string | null;
  udyam: string | null;
  payoutMethod: "bank" | "upi" | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  payoutUpi: string | null;
  docs: Partial<Record<DocKind, string>>;
  proofType: ProofType | null;
  proofNumber: string | null;
  /** When the owner declared the business is below the GST limit (set by the database). */
  gstExemptDeclaredAt: string | null;
  fssaiExpiresOn: string | null;
  drugLicenceExpiresOn: string | null;
  deliveryChargeRupees: number;
  shopOpen: boolean;
  /** Usual minutes to have an order ready. */
  prepMinutes: number | null;
}

export interface NewBusiness {
  name: string;
  kind: BusinessKind;
  phone?: string;
  address: string;
  lat: number;
  lng: number;
}

/** The owner and papers, sent for review. */
export interface KycForm {
  entityType: EntityType;
  ownerName: string;
  pan: string;
  aadhaarLast4: string;
  stateCode: string;
  gstin?: string;
  fssai?: string;
  drugLicence?: string;
  udyam?: string;
  payoutMethod: "bank" | "upi";
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  payoutUpi?: string;
  proofType: ProofType;
  proofNumber: string;
  /** No GSTIN: the owner declares the business is below the GST registration limit. */
  gstExempt: boolean;
  fssaiExpiresOn?: string;
  drugLicenceExpiresOn?: string;
}

export type BusinessJobStatus = "open" | "accepted" | "picked_up" | "completed" | "declined" | "cancelled";

export interface BusinessJob {
  id: string;
  dropoffArea: string;
  distanceKm: number;
  fare: number;
  feeRupees: number;
  status: BusinessJobStatus;
  assignedTo: string | null;
  createdAt: string;
  note: string | null;
  source: "app" | "api" | "order";
  reference: string | null;
  pickupCode?: string;
  deliveryCode?: string;
  dropoffAddress?: string;
  /** The shop paid the rider's fare by UPI, and the reference it gave. */
  riderPaidAt?: string | null;
  riderPayUtr?: string | null;
  /** The rider says that payment never arrived. */
  riderPayDisputedAt?: string | null;
}

/** Who to pay for a delivered job: the rider's name and the UPI ID Gigzen verified. */
export interface RiderPayee {
  name: string;
  upi: string | null;
  fare: number;
  paidAt: string | null;
  utr: string | null;
  disputedAt: string | null;
}

/** One month-end run: by an admin, or by the monthly schedule (ranBy null). */
export interface BillingRun {
  period: string;
  ranAt: string;
  invoices: number;
  planCharges: number;
  ranBy: string | null;
}

export interface NewDelivery {
  dropoffArea: string;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  note?: string;
}

export interface Charge {
  id: string;
  kind: "setup" | "plan" | "routing";
  amountRupees: number;
  description: string;
  period: string;
  status: "due" | "paid" | "waived";
  createdAt: string;
  invoiceId: string | null;
}

export interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  priceRupees: number;
  available: boolean;
  photoPath: string | null;
  diet: Diet | null;
  /** "2 pcs", "250 g", "serves 2", "pack of 6". */
  quantityLabel: string | null;
  /** 0 mild … 3 very hot. */
  spice: number | null;
  tags: ItemTag[];
  /** Printed price, shown struck through when higher than the price. */
  mrpRupees: number | null;
  brand: string | null;
  /** Units left when the shop counts stock; null when it does not. */
  stock: number | null;
  ingredients: string | null;
  allergens: string | null;
  options: OptionGroup[] | null;
}

export type OrderStatus = "placed" | "accepted" | "rejected" | "dispatched" | "delivered" | "cancelled";

export interface OrderLine {
  id: string;
  name: string;
  /** One unit, options included. */
  priceRupees: number;
  qty: number;
  options: ChosenOption[];
  /** The [group, choice] picks, when the order was placed with them. */
  selection?: Selection;
}

export interface Order {
  id: string;
  code: string;
  customerName: string;
  customerPhone: string;
  area: string;
  address: string;
  lat: number;
  lng: number;
  note: string | null;
  items: OrderLine[];
  subtotalRupees: number;
  deliveryRupees: number;
  totalRupees: number;
  status: OrderStatus;
  reason: string | null;
  jobId: string | null;
  createdAt: string;
  review: { stars: number; comment: string | null; photo_path: string | null; reply: string | null } | null;
  issues: { kind: string; details: string | null }[];
  discountRupees: number;
  couponCode: string | null;
  scheduledFor: string | null;
  /** Paid online through Razorpay (payments_v1.sql): collect nothing on delivery. */
  paidOnlineAt?: string | null;
}

export interface PublicShop {
  id: string;
  name: string;
  kind: BusinessKind;
  address: string;
  phone: string | null;
  lat: number;
  lng: number;
  open: boolean;
  deliveryRupees: number;
  /** Average stars from customers, and how many rated. */
  rating: number | null;
  ratings: number;
  prepMinutes: number | null;
  offers: Offer[];
  reviews: { stars: number; comment: string | null; photoUrl: string | null; reply: string | null; name: string; at: string }[];
  items: PublicItem[];
}

export interface PublicItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  priceRupees: number;
  photoUrl: string | null;
  diet: Diet | null;
  quantityLabel: string | null;
  spice: number | null;
  tags: ItemTag[];
  mrpRupees: number | null;
  brand: string | null;
  stock: number | null;
  soldOut: boolean;
  ingredients: string | null;
  allergens: string | null;
  /** Delivered in the last 30 days. */
  sold30d: number;
  options: OptionGroup[] | null;
}

export interface TrackedOrder {
  code: string;
  status: OrderStatus;
  reason: string | null;
  items: OrderLine[];
  subtotalRupees: number;
  deliveryRupees: number;
  totalRupees: number;
  area: string;
  address: string;
  lat: number;
  lng: number;
  note: string | null;
  createdAt: string;
  acceptedAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  shop: { id: string; name: string; phone: string | null; address: string; lat: number; lng: number; gstin: string | null; kind: BusinessKind };
  job: { status: BusinessJobStatus; acceptedAt: string | null; pickedUpAt: string | null; deliveredAt: string | null; distanceKm: number } | null;
  discountRupees: number;
  couponCode: string | null;
  scheduledFor: string | null;
  /** Who is bringing it: a first name, the vehicle and the plate's last four. Nothing else. */
  rider: { firstName: string; vehicle: string; plateLast4: string | null } | null;
  /** Where the rider is, only after pickup and only while fresh. */
  riderAt: { lat: number; lng: number; at: string } | null;
  deliveryCode: string | null;
  review: { stars: number; comment: string | null; photoUrl: string | null; reply: string | null } | null;
  issues: number;
}

export interface Invoice {
  id: string;
  number: string;
  period: string;
  issuedAt: string;
  taxMode: "gst" | "unregistered";
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  supplier: { name: string; address: string; gstin: string | null; pan: string | null; state_code: string; sac: string; email: string | null };
  recipient: { name: string; owner: string | null; address: string; gstin: string | null; pan: string | null; state_code: string | null };
  lines: { description: string; quantity: number; rate_paise: number; amount_paise: number }[];
  status: "due" | "paid";
}

export interface Payment {
  id: string;
  invoiceId: string | null;
  amountRupees: number;
  utr: string;
  status: "submitted" | "confirmed" | "rejected";
  reviewNote: string | null;
  createdAt: string;
}

export interface Company {
  legalName: string;
  address: string;
  gstin: string | null;
  upiId: string | null;
  supportEmail: string | null;
}

export interface Report {
  from: string;
  to: string;
  deliveries: {
    sent: number; delivered: number; cancelled: number; in_progress: number;
    avg_accept_min: number | null; avg_ride_min: number | null;
    fees_paise: number; fares: number; km: number; by_source: Record<string, number>;
  };
  orders: { placed: number; delivered: number; rejected: number; sales_paise: number; avg_order_paise: number };
  days: { day: string; sent: number; delivered: number; orders: number; sales_paise: number }[];
  areas: { area: string; count: number }[];
  top_items: { name: string; qty: number; sales_paise: number }[];
}

export type AdStatus = "pending" | "approved" | "rejected" | "paused" | "ended";

export interface AdCampaign {
  id: string;
  name: string;
  headline: string;
  itemId: string | null;
  budgetRupees: number;
  startsOn: string;
  endsOn: string | null;
  status: AdStatus;
  reviewNote: string | null;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface QueueBusiness extends Business {
  profileName: string | null;
  profilePhone: string | null;
  missing: string[];
  /** The checks the reviewer must tick before Verify works. */
  requiredChecks: string[];
  licenceOk: boolean;
  lastReview: { decision: string; checks: string[]; at: string; by: string | null } | null;
}

export interface QueueWorker {
  userId: string;
  legalName: string;
  vehicle: string;
  vehicleNumber: string | null;
  licenceNumber: string | null;
  upiId: string;
  idType: string;
  idPhotoPath: string;
  selfiePath: string;
  licencePhotoPath: string | null;
  rcPhotoPath: string | null;
  status: "pending" | "verified" | "rejected" | "suspended";
  reviewNote: string | null;
  submittedAt: string;
  profileName: string | null;
  profilePhone: string | null;
}

export interface QueuePayment extends Payment {
  businessName: string;
  invoiceNumber: string | null;
  dueRupees: number;
}

export type NoticeKind = "news" | "zone_alert" | "safety";

/** A delivery in progress on the shop's live map, and where its rider is. */
export interface LiveRider {
  jobId: string;
  status: "accepted" | "picked_up";
  dropoff: string;
  dropLat: number | null;
  dropLng: number | null;
  rider: string;
  vehicle: string | null;
  riderLat: number | null;
  riderLng: number | null;
  seenAt: string | null;
}

/** A Rider hub notice, as Gigzen's admins see it. */
export interface AdminNotice {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  area: string | null;
  radiusKm: number | null;
  createdAt: string;
  endsAt: string | null;
}

/** A help request, with the delivery it names. */
export interface AdminTicket {
  id: string;
  app: string;
  topic: "payment" | "delivery" | "account" | "app" | "safety" | "other";
  message: string;
  status: "open" | "answered" | "closed";
  reply: string | null;
  createdAt: string;
  name: string | null;
  phone: string | null;
  job: { dropoff: string; payout: number; status: string; shop: string | null; rider_paid_at: string | null; rider_pay_utr: string | null; rider_pay_disputed_at: string | null } | null;
}

export interface QueueAd extends AdCampaign {
  businessName: string;
  itemName: string | null;
}

/** The report's plans. Prices include GST. */
export const PLANS: Record<BusinessPlan, { monthly: number; routing: number; adCredit: number }> = {
  starter: { monthly: 0, routing: 12, adCredit: 0 },
  growth: { monthly: 999, routing: 10, adCredit: 300 },
  pro: { monthly: 2499, routing: 8, adCredit: 1000 },
};
export const SETUP_FEE = 999;

/** The same numbers post_job() uses, so the form can show them before sending. */
export const ROAD_FACTOR = 1.3;
export const MAX_DELIVERY_KM = 25;

export function estimate(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(r(toLat - fromLat) / 2) ** 2 +
    Math.cos(r(fromLat)) * Math.cos(r(toLat)) * Math.sin(r(toLng - fromLng) / 2) ** 2;
  const straight = 2 * 6371 * Math.asin(Math.sqrt(a));
  const km = Math.round(straight * ROAD_FACTOR * 10) / 10;
  return { straightKm: straight, km, fare: Math.round(25 + Math.max(0, km - 2) * 9) };
}

/**
 * The shop's page in the Waggle customer app, where customers order. Its web
 * address is set once the Waggle app is published (VITE_WAGGLE_WEB_URL); on a
 * development machine it is the local Waggle app on port 5175.
 */
export function shopLink(businessId: string): string | null {
  const base = (import.meta.env.VITE_WAGGLE_WEB_URL as string | undefined)?.replace(/\/$/, "");
  if (base) return `${base}/shop/${businessId}`;
  if (import.meta.env.DEV) return `${window.location.protocol}//${window.location.hostname}:5175/shop/${businessId}`;
  return null;
}

function need() {
  if (!supabase) throw new Error("Waggle Business needs a connection to the server.");
  return supabase;
}

const DOC_COLUMNS: Record<DocKind, string> = {
  pan: "doc_pan",
  aadhaar: "doc_aadhaar",
  selfie: "doc_selfie",
  shopfront: "doc_shopfront",
  fssai: "doc_fssai",
  drug_licence: "doc_drug_licence",
  proof: "doc_proof",
};

/** A public photo's address: catalog items, and customers' review photos. */
export function photoUrl(path: string | null | undefined, bucket: "catalog-photos" | "review-photos" = "catalog-photos"): string | null {
  if (!path || !supabase) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export interface GroupLine {
  id: string;
  member: string;
  itemId: string;
  name: string;
  qty: number;
  selection: Selection;
  diet: Diet | null;
  unitRupees: number;
  options: ChosenOption[];
}

export interface GroupCart {
  businessId: string;
  shop: string;
  host: string;
  status: "open" | "ordered" | "closed";
  expiresAt: string;
  orderToken: string | null;
  deliveryRupees: number;
  lines: GroupLine[];
}

function toBusiness(row: any): Business {
  const docs: Partial<Record<DocKind, string>> = {};
  for (const [kind, column] of Object.entries(DOC_COLUMNS)) if (row[column]) docs[kind as DocKind] = row[column];
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    kind: row.kind,
    phone: row.phone,
    address: row.address,
    lat: Number(row.lat),
    lng: Number(row.lng),
    gstin: row.gstin,
    fssai: row.fssai,
    status: row.status,
    plan: row.plan ?? "starter",
    reviewNote: row.review_note ?? null,
    createdAt: row.created_at,
    entityType: row.entity_type ?? null,
    ownerName: row.owner_name ?? null,
    pan: row.pan ?? null,
    aadhaarLast4: row.aadhaar_last4 ?? null,
    stateCode: row.state_code ?? null,
    drugLicence: row.drug_licence ?? null,
    udyam: row.udyam ?? null,
    payoutMethod: row.payout_method ?? null,
    bankAccountName: row.bank_account_name ?? null,
    bankAccountNumber: row.bank_account_number ?? null,
    bankIfsc: row.bank_ifsc ?? null,
    payoutUpi: row.payout_upi ?? null,
    docs,
    proofType: row.proof_type ?? null,
    proofNumber: row.proof_number ?? null,
    gstExemptDeclaredAt: row.gst_exempt_declared_at ?? null,
    fssaiExpiresOn: row.fssai_expires_on ?? null,
    drugLicenceExpiresOn: row.drug_licence_expires_on ?? null,
    deliveryChargeRupees: Number(row.delivery_charge_paise ?? 0) / 100,
    shopOpen: row.shop_open ?? true,
    prepMinutes: row.prep_minutes ?? null,
  };
}

function toJob(row: any): BusinessJob {
  const codes = Array.isArray(row.job_codes) ? row.job_codes[0] : row.job_codes;
  const details = Array.isArray(row.job_details) ? row.job_details[0] : row.job_details;
  return {
    id: row.id,
    dropoffArea: row.dropoff,
    distanceKm: Number(row.distance_km),
    fare: Number(row.payout),
    feeRupees: Number(row.fee_paise ?? 0) / 100,
    status: row.status,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    note: row.note,
    source: row.source ?? "app",
    reference: row.external_ref ?? null,
    pickupCode: codes?.pickup_code,
    deliveryCode: codes?.delivery_code,
    dropoffAddress: details?.dropoff_address,
    riderPaidAt: row.rider_paid_at ?? null,
    riderPayUtr: row.rider_pay_utr ?? null,
    riderPayDisputedAt: row.rider_pay_disputed_at ?? null,
  };
}

const toPayee = (row: any): RiderPayee | null => row ? ({
  name: row.name, upi: row.upi ?? null, fare: Number(row.fare), paidAt: row.paid_at ?? null, utr: row.utr ?? null, disputedAt: row.disputed_at ?? null,
}) : null;

const toLines = (items: any[]): OrderLine[] =>
  (items ?? []).map((l) => ({ id: l.id, name: l.name, priceRupees: Number(l.price_paise) / 100, qty: Number(l.qty), options: l.options ?? [], selection: l.selection ?? [] }));

const toOffer = (c: any): Offer => ({
  code: c.code,
  title: c.title,
  kind: c.kind,
  value: c.value,
  minOrderPaise: c.min_order_paise ?? 0,
  maxDiscountPaise: c.max_discount_paise ?? null,
  firstOrderOnly: Boolean(c.first_order_only),
});

function toOrder(row: any): Order {
  return {
    id: row.id,
    code: row.code,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    area: row.area,
    address: row.address,
    lat: Number(row.lat),
    lng: Number(row.lng),
    note: row.note,
    items: toLines(row.items),
    subtotalRupees: row.subtotal_paise / 100,
    deliveryRupees: row.delivery_paise / 100,
    totalRupees: row.total_paise / 100,
    status: row.status,
    reason: row.reason,
    jobId: row.job_id,
    createdAt: row.created_at,
    review: (Array.isArray(row.order_reviews) ? row.order_reviews[0] : row.order_reviews) ?? null,
    issues: row.order_issues ?? [],
    discountRupees: (row.discount_paise ?? 0) / 100,
    couponCode: row.coupon_code ?? null,
    scheduledFor: row.scheduled_for ?? null,
    paidOnlineAt: row.paid_online_at ?? null,
  };
}

function toPayment(row: any): Payment {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    amountRupees: row.amount_paise / 100,
    utr: row.utr,
    status: row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
  };
}

function toAd(row: any): AdCampaign {
  return {
    id: row.id,
    name: row.name,
    headline: row.headline,
    itemId: row.item_id,
    budgetRupees: row.monthly_budget_paise / 100,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
  };
}

/** The database's own message, which is written for the business to read. */
function explain(error: { message?: string } | null): Error {
  return new Error(error?.message || "Something went wrong. Try again.");
}

const clean = (s?: string | null) => s?.trim() || null;

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await need().rpc(fn, args);
  if (error) throw explain(error);
  return data as T;
}

function watch(table: string, businessId: string, onChange: () => void) {
  const client = supabase;
  if (!client) return () => undefined;
  const channel = client
    .channel(`business-${table}-${businessId}`)
    .on("postgres_changes", { event: "*", schema: "public", table, filter: `business_id=eq.${businessId}` }, onChange)
    .subscribe();
  return () => void client.removeChannel(channel);
}

export const BusinessService = {
  async myBusiness(userId: string): Promise<Business | null> {
    const { data, error } = await need().from("businesses").select("*").eq("owner_id", userId).maybeSingle();
    if (error) throw explain(error);
    return data ? toBusiness(data) : null;
  },

  async register(userId: string, business: NewBusiness): Promise<Business> {
    const { data, error } = await need()
      .from("businesses")
      .insert({
        owner_id: userId,
        name: business.name.trim(),
        kind: business.kind,
        phone: clean(business.phone),
        address: business.address.trim(),
        lat: business.lat,
        lng: business.lng,
      })
      .select("*")
      .single();
    if (error) throw explain(error);
    return toBusiness(data);
  },

  /** Editing name, address, pin or category sends the business back to review. */
  async update(businessId: string, changes: NewBusiness): Promise<Business> {
    const { data, error } = await need()
      .from("businesses")
      .update({
        name: changes.name.trim(),
        kind: changes.kind,
        phone: clean(changes.phone),
        address: changes.address.trim(),
        lat: changes.lat,
        lng: changes.lng,
      })
      .eq("id", businessId)
      .select("*")
      .single();
    if (error) throw explain(error);
    return toBusiness(data);
  },

  /** What Gigzen still needs before it can verify this business (empty when complete). */
  async missing(): Promise<string[]> {
    return (await rpc<string[] | null>("my_business_missing")) ?? [];
  },

  /**
   * The owner's details and papers. Photos go to the private business-docs
   * store under this account's own folder first; the row then points at them.
   */
  async saveKyc(business: Business, form: KycForm, photos: Partial<Record<DocKind, Blob>>): Promise<Business> {
    const client = need();
    const paths: Record<string, string> = {};
    for (const [kind, blob] of Object.entries(photos) as [DocKind, Blob][]) {
      const path = `${business.ownerId}/${kind}-${Date.now()}.jpg`;
      const { error } = await client.storage.from("business-docs").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw explain(error);
      paths[DOC_COLUMNS[kind]] = path;
    }
    const bank = form.payoutMethod === "bank";
    const { data, error } = await client
      .from("businesses")
      .update({
        entity_type: form.entityType,
        owner_name: form.ownerName.trim(),
        pan: form.pan.trim().toUpperCase(),
        aadhaar_last4: form.aadhaarLast4.trim(),
        state_code: form.stateCode,
        gstin: clean(form.gstin)?.toUpperCase() ?? null,
        fssai: clean(form.fssai),
        drug_licence: clean(form.drugLicence),
        udyam: clean(form.udyam)?.toUpperCase() ?? null,
        payout_method: form.payoutMethod,
        bank_account_name: bank ? clean(form.bankAccountName) : null,
        bank_account_number: bank ? clean(form.bankAccountNumber) : null,
        bank_ifsc: bank ? clean(form.bankIfsc)?.toUpperCase() ?? null : null,
        payout_upi: bank ? null : clean(form.payoutUpi),
        proof_type: form.proofType,
        proof_number: form.proofNumber.trim().toUpperCase(),
        // The database stamps the real time; this only says "declared".
        gst_exempt_declared_at: form.gstExempt && !clean(form.gstin) ? new Date().toISOString() : null,
        fssai_expires_on: form.fssaiExpiresOn || null,
        drug_licence_expires_on: form.drugLicenceExpiresOn || null,
        ...paths,
      })
      .eq("id", business.id)
      .select("*")
      .single();
    if (error) throw explain(error);
    return toBusiness(data);
  },

  /** Open or closed for orders, and the delivery charge customers pay the shop. Never sends it back to review. */
  async shopSettings(businessId: string, settings: { shopOpen: boolean; deliveryChargeRupees: number; prepMinutes: number | null }): Promise<Business> {
    const { data, error } = await need()
      .from("businesses")
      .update({ shop_open: settings.shopOpen, delivery_charge_paise: Math.round(settings.deliveryChargeRupees * 100), prep_minutes: settings.prepMinutes })
      .eq("id", businessId)
      .select("*")
      .single();
    if (error) throw explain(error);
    return toBusiness(data);
  },

  async isAdmin(): Promise<boolean> {
    const { data, error } = await need().rpc("is_admin");
    return !error && data === true;
  },

  // ---------------------------------------------------------------- deliveries

  async postJob(delivery: NewDelivery): Promise<BusinessJob> {
    return toJob(await rpc("post_job", {
      p_dropoff_area: delivery.dropoffArea.trim(),
      p_dropoff_address: delivery.dropoffAddress.trim(),
      p_dropoff_lat: delivery.dropoffLat,
      p_dropoff_lng: delivery.dropoffLng,
      p_note: delivery.note?.trim() || null,
    }));
  },

  async myJobs(businessId: string): Promise<BusinessJob[]> {
    const { data, error } = await need()
      .from("jobs")
      .select("id, dropoff, distance_km, payout, fee_paise, status, assigned_to, created_at, note, source, external_ref, rider_paid_at, rider_pay_utr, rider_pay_disputed_at, job_codes(pickup_code, delivery_code), job_details(dropoff_address)")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw explain(error);
    return (data ?? []).map(toJob);
  },

  async cancel(jobId: string): Promise<void> {
    const { error } = await need().from("jobs").update({ status: "cancelled" }).eq("id", jobId);
    if (error) throw explain(error);
  },

  /** Who to pay for a delivered job. Only the shop that sent it gets an answer. */
  async riderPayee(jobId: string): Promise<RiderPayee | null> {
    return toPayee(await rpc("job_rider_payee", { p_job: jobId }));
  },

  /** The shop paid the rider by UPI: record the UTR. The rider is told. */
  async markRiderPaid(jobId: string, utr: string): Promise<RiderPayee | null> {
    return toPayee(await rpc("mark_rider_paid", { p_job: jobId, p_utr: utr }));
  },

  /** Live updates to this business's jobs: accepted, picked up, delivered. */
  watchJobs(businessId: string, onChange: () => void) {
    return watch("jobs", businessId, onChange);
  },

  // ---------------------------------------------------------------- orders

  async orders(businessId: string): Promise<Order[]> {
    const { data, error } = await need()
      .from("orders")
      .select("*, order_reviews(stars, comment, photo_path, reply), order_issues(kind, details)")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw explain(error);
    return (data ?? []).map(toOrder);
  },

  watchOrders(businessId: string, onChange: () => void) {
    return watch("orders", businessId, onChange);
  },

  async respondOrder(orderId: string, accept: boolean, reason?: string): Promise<void> {
    await rpc("respond_order", { p_order: orderId, p_accept: accept, p_reason: reason ?? null });
  },

  async dispatchOrder(orderId: string): Promise<void> {
    await rpc("dispatch_order", { p_order: orderId });
  },

  async completeOrderSelf(orderId: string): Promise<void> {
    await rpc("complete_order_self", { p_order: orderId });
  },

  async cancelOrder(orderId: string, reason: string): Promise<void> {
    await rpc("cancel_order", { p_order: orderId, p_reason: reason });
  },

  // ---------------------------------------------------------------- the shop's public link (no account needed)

  async publicShop(businessId: string): Promise<PublicShop | null> {
    const row = await rpc<any>("public_shop", { p_business: businessId });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      address: row.address,
      phone: row.phone,
      lat: Number(row.lat),
      lng: Number(row.lng),
      open: row.open,
      deliveryRupees: row.delivery_paise / 100,
      rating: row.rating == null ? null : Number(row.rating),
      ratings: Number(row.ratings ?? 0),
      prepMinutes: row.prep_minutes ?? null,
      offers: (row.offers ?? []).map(toOffer),
      reviews: (row.reviews ?? []).map((r: any) => ({ stars: r.stars, comment: r.comment, photoUrl: photoUrl(r.photo, "review-photos"), reply: r.reply, name: r.name, at: r.at })),
      items: (row.items ?? []).map((i: any): PublicItem => ({
        id: i.id,
        name: i.name,
        description: i.description,
        category: i.category,
        priceRupees: i.price_paise / 100,
        photoUrl: photoUrl(i.photo),
        diet: i.diet ?? null,
        quantityLabel: i.quantity ?? null,
        spice: i.spice ?? null,
        tags: i.tags ?? [],
        mrpRupees: i.mrp_paise == null ? null : i.mrp_paise / 100,
        brand: i.brand ?? null,
        stock: i.stock ?? null,
        soldOut: Boolean(i.sold_out),
        ingredients: i.ingredients ?? null,
        allergens: i.allergens ?? null,
        sold30d: Number(i.sold_30d ?? 0),
        options: i.options ?? null,
      })),
    };
  },

  async placeOrder(order: {
    businessId: string; name: string; phone: string; area: string; address: string; lat: number; lng: number; note?: string;
    items: { id: string; qty: number; options?: Selection }[];
    coupon?: string | null;
    scheduledFor?: string | null;
  }): Promise<{ code: string; token: string; totalRupees: number }> {
    const row = await rpc<any>("place_order", {
      p_coupon: order.coupon || null,
      p_scheduled_for: order.scheduledFor || null,
      p_business: order.businessId,
      p_name: order.name.trim(),
      p_phone: order.phone,
      p_area: order.area.trim(),
      p_address: order.address.trim(),
      p_lat: order.lat,
      p_lng: order.lng,
      p_note: order.note?.trim() || null,
      p_items: order.items,
    });
    return { code: row.code, token: row.token, totalRupees: row.total_paise / 100 };
  },

  async trackOrder(token: string): Promise<TrackedOrder | null> {
    const row = await rpc<any>("track_order", { p_token: token });
    if (!row) return null;
    return {
      code: row.code,
      status: row.status,
      reason: row.reason,
      items: toLines(row.items),
      subtotalRupees: row.subtotal_paise / 100,
      deliveryRupees: row.delivery_paise / 100,
      totalRupees: row.total_paise / 100,
      area: row.area,
      address: row.address,
      lat: Number(row.lat),
      lng: Number(row.lng),
      note: row.note ?? null,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at ?? null,
      dispatchedAt: row.dispatched_at ?? null,
      deliveredAt: row.delivered_at ?? null,
      closedAt: row.closed_at ?? null,
      shop: { ...row.shop, lat: Number(row.shop.lat), lng: Number(row.shop.lng) },
      discountRupees: (row.discount_paise ?? 0) / 100,
      couponCode: row.coupon_code ?? null,
      scheduledFor: row.scheduled_for ?? null,
      job: row.job ? { status: row.job.status, acceptedAt: row.job.accepted_at, pickedUpAt: row.job.picked_up_at, deliveredAt: row.job.delivered_at, distanceKm: Number(row.job.distance_km) } : null,
      rider: row.rider ? { firstName: row.rider.first_name, vehicle: row.rider.vehicle, plateLast4: row.rider.plate_last4 ?? null } : null,
      riderAt: row.rider_at ? { lat: Number(row.rider_at.lat), lng: Number(row.rider_at.lng), at: row.rider_at.at } : null,
      deliveryCode: row.delivery_code ?? null,
      review: row.review ? { stars: row.review.stars, comment: row.review.comment ?? null, photoUrl: photoUrl(row.review.photo, "review-photos"), reply: row.review.reply ?? null } : null,
      issues: Number(row.issues ?? 0),
    };
  },

  async rateOrder(token: string, stars: number, comment?: string, photoPath?: string | null): Promise<"ok" | "already" | "not_yet" | "invalid" | "not_found"> {
    return rpc("rate_order", { p_token: token, p_stars: stars, p_comment: comment?.trim() || null, p_photo: photoPath ?? null });
  },

  /** A signed-in customer's review photo, into their own folder. */
  async uploadReviewPhoto(userId: string, photo: Blob): Promise<string> {
    const path = `${userId}/review-${Date.now()}.jpg`;
    const { error } = await need().storage.from("review-photos").upload(path, photo, { contentType: "image/jpeg", upsert: false });
    if (error) throw explain(error);
    return path;
  },

  async replyReview(orderId: string, reply: string): Promise<void> {
    await rpc("reply_review", { p_order: orderId, p_reply: reply });
  },

  // ---------------------------------------------------------------- group orders (by link, no account needed)

  async createGroupCart(businessId: string, host: string): Promise<{ token: string; hostKey: string }> {
    const r = await rpc<any>("create_group_cart", { p_business: businessId, p_host: host.trim() });
    return { token: r.token, hostKey: r.host_key };
  },

  async groupCart(token: string): Promise<GroupCart | null> {
    const r = await rpc<any>("group_cart_view", { p_token: token });
    if (!r) return null;
    return {
      businessId: r.business_id,
      shop: r.shop,
      host: r.host,
      status: r.status,
      expiresAt: r.expires_at,
      orderToken: r.order_token,
      deliveryRupees: r.delivery_paise / 100,
      lines: (r.lines ?? []).map((l: any) => ({
        id: l.id, member: l.member, itemId: l.item_id, name: l.name, qty: l.qty, selection: l.selection ?? [],
        diet: l.diet ?? null, unitRupees: l.unit_paise / 100, options: l.options ?? [],
      })),
    };
  },

  async groupAdd(token: string, member: string, itemId: string, qty: number, selection: Selection): Promise<void> {
    await rpc("group_cart_add", { p_token: token, p_member: member.trim(), p_item: itemId, p_qty: qty, p_selection: selection });
  },

  async groupRemove(token: string, lineId: string): Promise<void> {
    await rpc("group_cart_remove", { p_token: token, p_line: lineId });
  },

  async placeGroupOrder(token: string, hostKey: string, order: {
    name: string; phone: string; area: string; address: string; lat: number; lng: number; note?: string; coupon?: string | null; scheduledFor?: string | null;
  }): Promise<{ code: string; token: string; totalRupees: number }> {
    const row = await rpc<any>("place_group_order", {
      p_token: token, p_host_key: hostKey, p_name: order.name.trim(), p_phone: order.phone, p_area: order.area.trim(),
      p_address: order.address.trim(), p_lat: order.lat, p_lng: order.lng, p_note: order.note?.trim() || null,
      p_coupon: order.coupon || null, p_scheduled_for: order.scheduledFor || null,
    });
    return { code: row.code, token: row.token, totalRupees: row.total_paise / 100 };
  },

  // ---------------------------------------------------------------- the shop's own offers

  async coupons(businessId: string): Promise<Coupon[]> {
    const { data, error } = await need().from("coupons").select("*").eq("business_id", businessId).order("created_at", { ascending: false });
    if (error) throw explain(error);
    return (data ?? []).map((c: any) => ({
      ...toOffer(c), id: c.id, perPhoneLimit: c.per_phone_limit, usageLimit: c.usage_limit, startsAt: c.starts_at, endsAt: c.ends_at, active: c.active,
    }));
  },

  async saveCoupon(businessId: string, c: Omit<Coupon, "id" | "startsAt"> & { id?: string }): Promise<void> {
    const row = {
      business_id: businessId,
      code: c.code.trim().toUpperCase(),
      title: c.title.trim(),
      kind: c.kind,
      value: c.value,
      min_order_paise: c.minOrderPaise,
      max_discount_paise: c.maxDiscountPaise,
      per_phone_limit: c.perPhoneLimit,
      usage_limit: c.usageLimit,
      first_order_only: c.firstOrderOnly,
      ends_at: c.endsAt,
      active: c.active,
    };
    const { error } = c.id ? await need().from("coupons").update(row).eq("id", c.id) : await need().from("coupons").insert(row);
    if (error) throw explain(error);
  },

  async reportProblem(token: string, kind: string, details?: string): Promise<"ok" | "too_many" | "invalid" | "not_found"> {
    return rpc("report_order_problem", { p_token: token, p_kind: kind, p_details: details?.trim() || null });
  },

  async cancelMyOrder(token: string): Promise<"ok" | "too_late" | "not_found"> {
    return rpc("cancel_my_order", { p_token: token });
  },

  // ---------------------------------------------------------------- plans, bills, invoices, payments

  async changePlan(plan: BusinessPlan): Promise<Business> {
    return toBusiness(await rpc("change_plan", { p_plan: plan }));
  },

  async charges(businessId: string): Promise<Charge[]> {
    const { data, error } = await need()
      .from("business_charges")
      .select("id, kind, amount_paise, description, period, status, created_at, invoice_id")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw explain(error);
    return (data ?? []).map((row: any) => ({
      id: row.id,
      kind: row.kind,
      amountRupees: Number(row.amount_paise) / 100,
      description: row.description,
      period: row.period,
      status: row.status,
      createdAt: row.created_at,
      invoiceId: row.invoice_id ?? null,
    }));
  },

  async invoices(businessId: string): Promise<Invoice[]> {
    const { data, error } = await need()
      .from("invoices")
      .select("*")
      .eq("business_id", businessId)
      .order("period", { ascending: false });
    if (error) throw explain(error);
    return (data ?? []).map((row: any) => ({
      id: row.id,
      number: row.number,
      period: row.period,
      issuedAt: row.issued_at,
      taxMode: row.tax_mode,
      taxablePaise: row.taxable_paise,
      cgstPaise: row.cgst_paise,
      sgstPaise: row.sgst_paise,
      igstPaise: row.igst_paise,
      totalPaise: row.total_paise,
      supplier: row.supplier,
      recipient: row.recipient,
      lines: row.lines ?? [],
      status: row.status,
    }));
  },

  async payments(businessId: string): Promise<Payment[]> {
    const { data, error } = await need()
      .from("payments")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw explain(error);
    return (data ?? []).map(toPayment);
  },

  async submitPayment(amountRupees: number, utr: string, invoiceId?: string): Promise<void> {
    await rpc("submit_payment", { p_amount_paise: Math.round(amountRupees * 100), p_utr: utr, p_invoice: invoiceId ?? null });
  },

  /** The Waggle Send fee: what it is, and whether customers pay it yet. */
  async sendFee(): Promise<{ live: boolean; rupees: number; upiId: string | null }> {
    const { data, error } = await need().from("company_settings").select("send_fee_live, send_fee_paise, upi_id").maybeSingle();
    if (error || !data) return { live: false, rupees: 15, upiId: null };
    return { live: Boolean(data.send_fee_live), rupees: Number(data.send_fee_paise ?? 1500) / 100, upiId: data.upi_id ?? null };
  },

  async setSendFee(live: boolean, rupeesAmount?: number): Promise<void> {
    await rpc("admin_set_send_fee", { p_live: live, p_paise: rupeesAmount == null ? null : Math.round(rupeesAmount * 100) });
  },

  async company(): Promise<Company | null> {
    const { data, error } = await need().from("company_settings").select("*").maybeSingle();
    if (error || !data) return null;
    return { legalName: data.legal_name, address: data.address, gstin: data.gstin, upiId: data.upi_id, supportEmail: data.support_email };
  },

  // ---------------------------------------------------------------- reports

  async report(from: string, to: string): Promise<Report> {
    return rpc("business_report", { p_from: from, p_to: to });
  },

  // ---------------------------------------------------------------- ads

  async campaigns(businessId: string): Promise<AdCampaign[]> {
    const { data, error } = await need()
      .from("ad_campaigns")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    if (error) throw explain(error);
    return (data ?? []).map(toAd);
  },

  /** Ad credit used this month, from what the ad server has recorded. */
  async adSpentThisMonth(): Promise<number> {
    const start = new Date();
    start.setDate(1);
    const { data, error } = await need()
      .from("ad_spend")
      .select("cost_paise")
      .gte("day", start.toISOString().slice(0, 10));
    if (error) return 0;
    return (data ?? []).reduce((sum: number, row: any) => sum + row.cost_paise, 0) / 100;
  },

  async saveCampaign(campaign: { id?: string; name: string; headline: string; itemId: string | null; budgetRupees: number; startsOn: string; endsOn: string | null }): Promise<void> {
    await rpc("save_ad_campaign", {
      p_id: campaign.id ?? null,
      p_name: campaign.name.trim(),
      p_headline: campaign.headline.trim(),
      p_item: campaign.itemId,
      p_budget_paise: Math.round(campaign.budgetRupees * 100),
      p_starts_on: campaign.startsOn,
      p_ends_on: campaign.endsOn,
    });
  },

  async setCampaignState(id: string, state: "paused" | "approved" | "ended"): Promise<void> {
    await rpc("set_ad_campaign_state", { p_id: id, p_state: state });
  },

  // ---------------------------------------------------------------- the delivery API

  async apiKeys(): Promise<ApiKey[]> {
    const rows = await rpc<any[]>("my_api_keys");
    return (rows ?? []).map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at }));
  },

  /** The whole key, once. It cannot be shown again. */
  async createApiKey(name: string): Promise<string> {
    return rpc("create_api_key", { p_name: name.trim() });
  },

  async revokeApiKey(id: string): Promise<void> {
    await rpc("revoke_api_key", { p_id: id });
  },

  // ---------------------------------------------------------------- catalog

  async catalog(businessId: string): Promise<CatalogItem[]> {
    const { data, error } = await need()
      .from("catalog_items")
      .select("id, name, description, category, price_paise, available, photo_path, diet, quantity_label, spice, tags, mrp_paise, brand, stock, ingredients, allergens, options")
      .eq("business_id", businessId)
      .order("category", { ascending: true, nullsFirst: false })
      .order("name", { ascending: true });
    if (error) throw explain(error);
    return (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      priceRupees: Number(row.price_paise) / 100,
      available: row.available,
      photoPath: row.photo_path ?? null,
      diet: row.diet ?? null,
      quantityLabel: row.quantity_label ?? null,
      spice: row.spice ?? null,
      tags: row.tags ?? [],
      mrpRupees: row.mrp_paise == null ? null : Number(row.mrp_paise) / 100,
      brand: row.brand ?? null,
      stock: row.stock ?? null,
      ingredients: row.ingredients ?? null,
      allergens: row.allergens ?? null,
      options: row.options ?? null,
    }));
  },

  /** Upload a product photo to this shop's own folder; returns its path for the item. */
  async uploadCatalogPhoto(ownerId: string, photo: Blob): Promise<string> {
    const path = `${ownerId}/item-${Date.now()}.jpg`;
    const { error } = await need().storage.from("catalog-photos").upload(path, photo, { contentType: "image/jpeg", upsert: false });
    if (error) throw explain(error);
    return path;
  },

  async saveItem(businessId: string, item: Omit<CatalogItem, "id"> & { id?: string }): Promise<void> {
    const row = {
      business_id: businessId,
      name: item.name.trim(),
      description: clean(item.description ?? undefined),
      category: clean(item.category ?? undefined),
      price_paise: Math.round(item.priceRupees * 100),
      available: item.available,
      photo_path: item.photoPath,
      diet: item.diet,
      quantity_label: clean(item.quantityLabel),
      spice: item.spice,
      tags: item.tags,
      mrp_paise: item.mrpRupees == null ? null : Math.round(item.mrpRupees * 100),
      brand: clean(item.brand),
      stock: item.stock,
      ingredients: clean(item.ingredients),
      allergens: clean(item.allergens),
      options: item.options && item.options.length ? item.options : null,
    };
    const query = item.id
      ? need().from("catalog_items").update(row).eq("id", item.id)
      : need().from("catalog_items").insert(row);
    const { error } = await query;
    if (error) throw explain(error);
  },

  async removeItem(itemId: string): Promise<void> {
    const { error } = await need().from("catalog_items").delete().eq("id", itemId);
    if (error) throw explain(error);
  },

  // ---------------------------------------------------------------- admin (Gigzen only; the database checks)

  async businessQueue(): Promise<QueueBusiness[]> {
    const rows = await rpc<any[]>("admin_business_queue");
    return (rows ?? []).map((row) => ({
      ...toBusiness(row),
      profileName: row.profile_name,
      profilePhone: row.profile_phone,
      missing: row.missing ?? [],
      requiredChecks: row.required_checks ?? [],
      licenceOk: row.licence_ok !== false,
      lastReview: row.last_review ?? null,
    }));
  },

  async reviewBusiness(businessId: string, decision: "verify" | "reject" | "suspend", note?: string, checks: string[] = []): Promise<void> {
    await rpc("admin_review_business", { p_business: businessId, p_decision: decision, p_note: note ?? null, p_checks: checks });
  },

  async workerQueue(): Promise<QueueWorker[]> {
    const rows = await rpc<any[]>("admin_worker_queue");
    return (rows ?? []).map((row) => ({
      userId: row.user_id,
      legalName: row.legal_name,
      vehicle: row.vehicle,
      vehicleNumber: row.vehicle_number,
      licenceNumber: row.licence_number,
      upiId: row.upi_id,
      idType: row.id_type,
      idPhotoPath: row.id_photo_path,
      selfiePath: row.selfie_path,
      licencePhotoPath: row.licence_photo_path ?? null,
      rcPhotoPath: row.rc_photo_path ?? null,
      status: row.status,
      reviewNote: row.review_note,
      submittedAt: row.submitted_at,
      profileName: row.profile_name,
      profilePhone: row.profile_phone,
    }));
  },

  async reviewWorker(userId: string, decision: "verify" | "reject" | "suspend", note?: string): Promise<void> {
    await rpc("admin_review_worker", { p_user: userId, p_decision: decision, p_note: note ?? null });
  },

  async paymentQueue(): Promise<QueuePayment[]> {
    const rows = await rpc<any[]>("admin_payment_queue");
    return (rows ?? []).map((row) => ({ ...toPayment(row), businessName: row.business_name, invoiceNumber: row.invoice_number, dueRupees: row.due_paise / 100 }));
  },

  async reviewPayment(id: string, decision: "confirm" | "reject", note?: string): Promise<void> {
    await rpc("admin_review_payment", { p_payment: id, p_decision: decision, p_note: note ?? null });
  },

  async adQueue(): Promise<QueueAd[]> {
    const rows = await rpc<any[]>("admin_ad_queue");
    return (rows ?? []).map((row) => ({ ...toAd(row), businessName: row.business_name, itemName: row.item_name }));
  },

  async reviewAd(id: string, approve: boolean, note?: string): Promise<void> {
    await rpc("admin_review_ad", { p_id: id, p_approve: approve, p_note: note ?? null });
  },

  async monthEnd(period: string): Promise<{ invoices: number; plan_charges: number }> {
    return rpc("admin_month_end", { p_period: period });
  },

  async liveRiders(businessId: string): Promise<LiveRider[]> {
    const rows = await rpc<any[]>("business_live_riders", { p_business: businessId });
    return (rows ?? []).map((r) => ({
      jobId: r.job_id, status: r.status, dropoff: r.dropoff,
      dropLat: r.drop_lat == null ? null : Number(r.drop_lat), dropLng: r.drop_lng == null ? null : Number(r.drop_lng),
      rider: r.rider || "Rider", vehicle: r.vehicle ?? null,
      riderLat: r.rider_lat == null ? null : Number(r.rider_lat), riderLng: r.rider_lng == null ? null : Number(r.rider_lng),
      seenAt: r.seen_at ?? null,
    }));
  },

  async adminNotices(): Promise<AdminNotice[]> {
    const { data, error } = await need().from("announcements").select("*").order("created_at", { ascending: false }).limit(40);
    if (error) throw explain(error);
    return (data ?? []).map((n: any) => ({
      id: n.id, kind: n.kind, title: n.title, body: n.body, area: n.area, radiusKm: n.radius_km == null ? null : Number(n.radius_km), createdAt: n.created_at, endsAt: n.ends_at,
    }));
  },

  async postNotice(n: { kind: NoticeKind; title: string; body: string; area: string | null; lat: number | null; lng: number | null; radiusKm: number | null; hours: number | null }): Promise<void> {
    await rpc("admin_post_announcement", {
      p_kind: n.kind, p_title: n.title.trim(), p_body: n.body.trim(), p_lat: n.lat, p_lng: n.lng, p_radius_km: n.radiusKm, p_area: n.area, p_hours: n.hours,
    });
  },

  async endNotice(id: string): Promise<void> {
    await rpc("admin_end_announcement", { p_id: id });
  },

  async ticketQueue(): Promise<AdminTicket[]> {
    const rows = await rpc<any[]>("admin_ticket_queue");
    return (rows ?? []).map((k) => ({
      id: k.id, app: k.app, topic: k.topic, message: k.message, status: k.status, reply: k.reply, createdAt: k.created_at,
      name: k.name ?? null, phone: k.phone ?? null, job: k.job ? { ...k.job, payout: Number(k.job.payout) } : null,
    }));
  },

  async replyTicket(id: string, reply: string, close: boolean): Promise<void> {
    await rpc("admin_reply_ticket", { p_id: id, p_reply: reply.trim(), p_close: close });
  },

  async billingRuns(): Promise<BillingRun[]> {
    const { data, error } = await need().from("billing_runs").select("*").order("period", { ascending: false }).limit(12);
    if (error) throw explain(error);
    return (data ?? []).map((r: any) => ({ period: r.period, ranAt: r.ran_at, invoices: r.invoices, planCharges: r.plan_charges, ranBy: r.ran_by }));
  },

  /** A short-lived link to a verification photo, for its owner or an admin to look at. */
  async docUrl(path: string, bucket: "worker-docs" | "business-docs" = "worker-docs"): Promise<string | null> {
    const { data, error } = await need().storage.from(bucket).createSignedUrl(path, 300);
    return error ? null : data.signedUrl;
  },
};
