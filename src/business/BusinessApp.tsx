import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Toasts } from "../components/Toasts";
import { useT } from "../i18n";
import { AuthScreen } from "../screens/AuthScreen";
import { useAuthStore } from "../stores/useAuthStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import { AdsScreen, ApiScreen } from "./BusinessGrowth";
import { VerifyBusinessScreen } from "./BusinessKyc";
import { BillingScreen } from "./BusinessMoney";
import { CatalogScreen } from "./BusinessCatalog";
import { OffersScreen } from "./BusinessOffers";
import { AdminScreen, BusinessNav, MoreScreen } from "./BusinessMore";
import { OrdersScreen } from "./BusinessOrders";
import { ReportsScreen } from "./BusinessReports";
import { type BillingRun,
  BusinessService,
  type AdCampaign,
  type ApiKey,
  type Business,
  type BusinessJob,
  type CatalogItem,
  type Charge,
  type Coupon,
  type Company,
  type Invoice,
  type Order,
  type Payment,
  type QueueAd,
  type QueueBusiness,
  type QueuePayment,
  type QueueWorker,
  type Report,
} from "./BusinessService";
import { BusinessHomeScreen, PendingScreen, RegisterBusinessScreen, SendDeliveryForm, SendDeliveryScreen, rupees } from "./BusinessScreens";

/**
 * Waggle Business: the app and web dashboard every kind of shop uses to run
 * its Waggle deliveries and orders. Same code base and same backend as Waggle
 * Gig and the Waggle customer app, built with `npm run dev:business` /
 * `npm run build:business`.
 *
 * Pages: deliveries (home and send), orders, catalog, plan and bills, reports,
 * ads, the delivery API, business details, owner verification, and, for
 * Gigzen's founders only, admin review. What customers see (a shop's page, the
 * basket, tracking) is the Waggle app's, in src/waggle.
 */
type Page = "home" | "send" | "orders" | "catalog" | "offers" | "billing" | "reports" | "ads" | "api" | "business" | "verify" | "more" | "admin";

const PAGES: [string, Page][] = [
  ["/", "home"], ["/send", "send"], ["/orders", "orders"], ["/catalog", "catalog"], ["/offers", "offers"], ["/billing", "billing"],
  ["/reports", "reports"], ["/ads", "ads"], ["/api", "api"], ["/business", "business"], ["/verify", "verify"],
  ["/more", "more"], ["/admin", "admin"],
];

export default function BusinessApp() {
  const initSession = useAuthStore((state) => state.initSession);
  useEffect(() => {
    void initSession();
  }, [initSession]);

  return (
    <>
      <Toasts />
      <Routes>
        <Route path="/auth" element={<AuthScreen />} />
        {import.meta.env.DEV ? previewRoutes() : null}
        {PAGES.map(([path, page]) => <Route key={path} path={path} element={<BusinessGate page={page} />} />)}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function BusinessGate({ page }: { page: Page }) {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const push = useNotificationStore((state) => state.push);
  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [missing, setMissing] = useState<string[]>([]);
  const [admin, setAdmin] = useState(false);
  const [jobs, setJobs] = useState<BusinessJob[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [adSpent, setAdSpent] = useState(0);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [queueB, setQueueB] = useState<QueueBusiness[]>([]);
  const [queueW, setQueueW] = useState<QueueWorker[]>([]);
  const [queueP, setQueueP] = useState<QueuePayment[]>([]);
  const [queueA, setQueueA] = useState<QueueAd[]>([]);
  const [runs, setRuns] = useState<BillingRun[]>([]);
  const [error, setError] = useState("");
  const seenOrders = useRef<Set<string> | null>(null);

  /** What changes second to second: deliveries, orders and the fees they bill. */
  const loadLive = useCallback(async (b: Business) => {
    const [j, o, c] = await Promise.all([BusinessService.myJobs(b.id), BusinessService.orders(b.id), BusinessService.charges(b.id)]);
    setJobs(j);
    setOrders(o);
    setCharges(c);
    // A new order is the one thing a shop must not miss.
    const placed = o.filter((x) => x.status === "placed");
    if (seenOrders.current) {
      for (const order of placed) {
        if (!seenOrders.current.has(order.id)) push(t("bx_newOrderTitle", { code: order.code }), t("bx_newOrderBody", { name: order.customerName, total: rupees(order.totalRupees) }), "job");
      }
    }
    seenOrders.current = new Set(o.map((x) => x.id));
  }, [push, t]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [mine, isAdmin] = await Promise.all([BusinessService.myBusiness(user.id), BusinessService.isAdmin()]);
      setBusiness(mine);
      setAdmin(isAdmin);
      if (mine) setMissing(await BusinessService.missing());
      if (mine && mine.status === "verified") {
        const [i, inv, pay, co, ads, spent, k, cps] = await Promise.all([
          BusinessService.catalog(mine.id),
          BusinessService.invoices(mine.id),
          BusinessService.payments(mine.id),
          BusinessService.company(),
          BusinessService.campaigns(mine.id),
          BusinessService.adSpentThisMonth(),
          BusinessService.apiKeys(),
          BusinessService.coupons(mine.id),
          loadLive(mine),
        ]);
        setCoupons(cps);
        setItems(i);
        setInvoices(inv);
        setPayments(pay);
        setCompany(co);
        setCampaigns(ads);
        setAdSpent(spent);
        setKeys(k);
      }
      if (isAdmin) {
        const [b, w, p, a, r] = await Promise.all([
          BusinessService.businessQueue(), BusinessService.workerQueue(), BusinessService.paymentQueue(), BusinessService.adQueue(),
          BusinessService.billingRuns(),
        ]);
        setRuns(r);
        setQueueB(b);
        setQueueW(w);
        setQueueP(p);
        setQueueA(a);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("biz_errGeneric"));
    }
  }, [user, t, loadLive]);

  useEffect(() => {
    void load();
  }, [load]);

  // Taken, picked up, delivered, and new orders, without a refresh.
  useEffect(() => {
    if (!business || business.status !== "verified") return undefined;
    const refresh = () => void loadLive(business).catch(() => undefined);
    const stopJobs = BusinessService.watchJobs(business.id, refresh);
    const stopOrders = BusinessService.watchOrders(business.id, refresh);
    return () => { stopJobs(); stopOrders(); };
  }, [business?.id, business?.status, loadLive]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return <Navigate to="/auth" replace />;
  if (business === undefined) {
    return <div className="biz-frame"><p className="biz-loading">{error || t("biz_loading")}</p></div>;
  }
  const out = () => void signOut();
  const newOrders = orders.filter((o) => o.status === "placed").length;
  const nav = <BusinessNav admin={admin} newOrders={newOrders} />;
  const verified = business?.status === "verified";
  const saved = (b: Business) => { setBusiness(b); void load(); };

  // Gigzen's founders reach the review queue whether or not they run a business themselves.
  if (page === "admin" && admin) {
    return (
      <AdminScreen
        businesses={queueB}
        workers={queueW}
        payments={queueP}
        ads={queueA}
        nav={verified ? nav : undefined}
        docUrl={BusinessService.docUrl}
        onReviewBusiness={async (id, d, note, checks) => { await BusinessService.reviewBusiness(id, d, note, checks); await load(); }}
        onReviewWorker={async (id, d, note) => { await BusinessService.reviewWorker(id, d, note); await load(); }}
        onReviewPayment={async (id, d, note) => { await BusinessService.reviewPayment(id, d, note); await load(); }}
        onReviewAd={async (id, ok, note) => { await BusinessService.reviewAd(id, ok, note); await load(); }}
        onMonthEnd={async (period) => { const r = await BusinessService.monthEnd(period); await load(); return r; }}
        runs={runs}
      />
    );
  }

  if (business === null) {
    return (
      <RegisterBusinessScreen
        onSignOut={out}
        nav={admin ? <BusinessNav admin /> : undefined}
        onSubmit={async (b) => { saved(await BusinessService.register(user.id, b)); navigate("/verify"); }}
      />
    );
  }

  // Owner verification and the business details are open in every state:
  // they are how a new, waiting or rejected business gets verified.
  if (page === "verify") {
    return <VerifyBusinessScreen business={business} nav={verified ? nav : undefined} onBack={() => navigate("/")} onSaved={saved} />;
  }
  if (page === "business") {
    return (
      <RegisterBusinessScreen
        initial={business}
        title={t("biz_profileTitle")}
        subtitle={t("biz_profileNote")}
        submitLabel={t(verified ? "biz_save" : "biz_fixDetails")}
        onSignOut={out}
        nav={verified ? nav : undefined}
        onSubmit={async (b) => { saved(await BusinessService.update(business.id, b)); if (!verified) navigate("/"); }}
      />
    );
  }

  if (!verified) {
    return (
      <PendingScreen
        business={business}
        missing={missing}
        onRefresh={() => void load()}
        onSignOut={out}
        onFix={() => navigate("/business")}
        onVerify={() => navigate("/verify")}
      />
    );
  }

  const send = async (delivery: Parameters<typeof BusinessService.postJob>[0]) => {
    await BusinessService.postJob(delivery);
    push(t("biz_sentTitle"), t("biz_sentBody"), "job");
    await loadLive(business);
  };
  const live = async () => loadLive(business);

  switch (page) {
    case "send":
      return <SendDeliveryScreen business={business} onBack={() => navigate("/")} onSend={async (d) => { await send(d); navigate("/"); }} />;
    case "orders":
      return (
        <OrdersScreen
          business={business}
          orders={orders}
          nav={nav}
          onRespond={async (id, accept, reason) => { await BusinessService.respondOrder(id, accept, reason); await live(); }}
          onDispatch={async (id) => { await BusinessService.dispatchOrder(id); push(t("biz_sentTitle"), t("biz_sentBody"), "job"); await live(); }}
          onSelfDelivered={async (id) => { await BusinessService.completeOrderSelf(id); await live(); }}
          onCancel={async (id, reason) => { await BusinessService.cancelOrder(id, reason); await live(); }}
          onReply={async (id, reply) => { await BusinessService.replyReview(id, reply); await live(); }}
          onSettings={async (s) => { setBusiness(await BusinessService.shopSettings(business.id, s)); }}
        />
      );
    case "catalog":
      return (
        <CatalogScreen
          business={business}
          items={items}
          nav={nav}
          onSave={async (item) => { await BusinessService.saveItem(business.id, item); await load(); }}
          onRemove={async (id) => { await BusinessService.removeItem(id); await load(); }}
          onUploadPhoto={(photo) => BusinessService.uploadCatalogPhoto(business.ownerId, photo)}
        />
      );
    case "offers":
      return (
        <OffersScreen
          business={business}
          coupons={coupons}
          nav={nav}
          onSave={async (c) => { await BusinessService.saveCoupon(business.id, c); setCoupons(await BusinessService.coupons(business.id)); }}
        />
      );
    case "billing":
      return (
        <BillingScreen
          business={business}
          charges={charges}
          invoices={invoices}
          payments={payments}
          company={company}
          nav={nav}
          onChangePlan={async (plan) => { setBusiness(await BusinessService.changePlan(plan)); await load(); }}
          onSubmitPayment={async (amount, utr, invoiceId) => { await BusinessService.submitPayment(amount, utr, invoiceId); setPayments(await BusinessService.payments(business.id)); }}
        />
      );
    case "reports":
      return <ReportsScreen business={business} nav={nav} onLoad={BusinessService.report} />;
    case "ads":
      return (
        <AdsScreen
          business={business}
          campaigns={campaigns}
          items={items}
          spent={adSpent}
          nav={nav}
          onSave={async (c) => { await BusinessService.saveCampaign(c); setCampaigns(await BusinessService.campaigns(business.id)); }}
          onState={async (id, state) => { await BusinessService.setCampaignState(id, state); setCampaigns(await BusinessService.campaigns(business.id)); }}
        />
      );
    case "api":
      return (
        <ApiScreen
          business={business}
          keys={keys}
          nav={nav}
          onCreate={async (name) => { const key = await BusinessService.createApiKey(name); setKeys(await BusinessService.apiKeys()); return key; }}
          onRevoke={async (id) => { await BusinessService.revokeApiKey(id); setKeys(await BusinessService.apiKeys()); }}
        />
      );
    case "more":
      return <MoreScreen business={business} admin={admin} nav={nav} />;
    default:
      return (
        <BusinessHomeScreen
          business={business}
          jobs={jobs}
          nav={nav}
          onSignOut={out}
          onSend={() => navigate("/send")}
          sendPanel={<SendDeliveryForm business={business} onSend={send} />}
          onPayee={BusinessService.riderPayee}
          onMarkPaid={async (id, utr) => { await BusinessService.markRiderPaid(id, utr); await live(); }}
          onCancel={async (id) => {
            try {
              await BusinessService.cancel(id);
            } catch (err) {
              push(t("biz_errGeneric"), err instanceof Error ? err.message : "", "system");
            }
            await live();
          }}
        />
      );
  }
}

/* ------------------------------------------------------------------ dev-only previews
   Screens with sample data, so they can be looked at without signing in. Vite
   drops them from a production build. The live app never shows any of this. */

const SAMPLE_BUSINESS: Business = {
  id: "preview",
  ownerId: "owner",
  name: "Janpath Tiffins",
  kind: "restaurant",
  phone: "+91 98765 43210",
  address: "Unit 3, Janpath, Bhubaneswar",
  lat: 20.2961,
  lng: 85.8245,
  gstin: "21ABCDE1234F1Z5",
  fssai: "12345678901234",
  status: "verified",
  plan: "growth",
  reviewNote: null,
  createdAt: new Date().toISOString(),
  entityType: "proprietor",
  ownerName: "Sunita Das",
  pan: "ABCDE1234F",
  aadhaarLast4: "4321",
  stateCode: "21",
  drugLicence: null,
  udyam: null,
  payoutMethod: "bank",
  bankAccountName: "Sunita Das",
  bankAccountNumber: "123456789012",
  bankIfsc: "SBIN0001234",
  payoutUpi: null,
  docs: {},
  proofType: "gst",
  proofNumber: "21ABCDE1234F1Z5",
  gstExemptDeclaredAt: null,
  fssaiExpiresOn: "2027-08-31",
  drugLicenceExpiresOn: null,
  deliveryChargeRupees: 20,
  shopOpen: true,
  prepMinutes: 15,
};
const NEW_SHOP: Business = { ...SAMPLE_BUSINESS, name: "Maa Tarini Electronics", kind: "electronics", status: "pending", entityType: null, ownerName: null, pan: null, aadhaarLast4: null, stateCode: null, gstin: null, fssai: null, payoutMethod: null, bankAccountName: null, bankAccountNumber: null, bankIfsc: null, proofType: null, proofNumber: null, fssaiExpiresOn: null };

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const SAMPLE_JOBS: BusinessJob[] = [
  { id: "1", dropoffArea: "Saheed Nagar", distanceKm: 2.9, fare: 33, feeRupees: 10, status: "open", assignedTo: null, createdAt: minutesAgo(2), note: null, source: "order", reference: "K7QM4T",
    pickupCode: "4821", deliveryCode: "7390", dropoffAddress: "Plot 12, near Ram Mandir, Saheed Nagar" },
  { id: "2", dropoffArea: "Nayapalli", distanceKm: 4.4, fare: 47, feeRupees: 10, status: "picked_up", assignedTo: "w", createdAt: minutesAgo(18), note: null, source: "api", reference: "WEB-1001",
    deliveryCode: "1164", dropoffAddress: "B-14, CRP Square, Nayapalli" },
  { id: "3", dropoffArea: "Patia", distanceKm: 7.8, fare: 77, feeRupees: 10, status: "completed", assignedTo: "w", createdAt: minutesAgo(64), note: null, source: "app", reference: null },
  { id: "4", dropoffArea: "Old Town", distanceKm: 3.1, fare: 35, feeRupees: 10, status: "completed", assignedTo: "w", createdAt: minutesAgo(120), note: null, source: "order", reference: "R4TC9M",
    riderPaidAt: minutesAgo(100), riderPayUtr: "423456789012" },
];
const SAMPLE_ITEMS: CatalogItem[] = [
  { id: "a", name: "Masala dosa", description: "With sambar and two chutneys", category: "Tiffin", priceRupees: 60, available: true, photoPath: null, diet: "veg", quantityLabel: "1 plate", spice: 1, tags: ["bestseller"], mrpRupees: null, brand: null, stock: null, ingredients: "Rice, urad dal, potato masala", allergens: null, options: [{ name: "Size", required: true, max: 1, choices: [{ name: "Half", price_paise: 0 }, { name: "Full", price_paise: 3000 }] }, { name: "Add-ons", required: false, max: 2, choices: [{ name: "Extra chutney", price_paise: 500 }, { name: "Ghee", price_paise: 1500 }] }] },
  { id: "b", name: "Idli (2 pcs)", description: null, category: "Tiffin", priceRupees: 40, available: true, photoPath: null, diet: "veg", quantityLabel: "2 pcs", spice: 0, tags: [], mrpRupees: null, brand: null, stock: null, ingredients: null, allergens: null, options: null },
  { id: "c", name: "Filter coffee", description: null, category: "Drinks", priceRupees: 25, available: true, photoPath: null, diet: "veg", quantityLabel: "150 ml", spice: null, tags: ["new"], mrpRupees: null, brand: null, stock: 12, ingredients: null, allergens: "Milk", options: null },
];
const SAMPLE_ORDERS: Order[] = [
  { id: "o1", code: "K7QM4T", customerName: "Priya Mohanty", customerPhone: "+919876543210", area: "Saheed Nagar", address: "Plot 12, near Ram Mandir", lat: 20.2893, lng: 85.8412,
    note: "Ring the bell twice", items: [{ id: "a", name: "Masala dosa", priceRupees: 60, qty: 2, options: [] }, { id: "c", name: "Filter coffee", priceRupees: 25, qty: 2, options: [] }],
    subtotalRupees: 170, deliveryRupees: 20, totalRupees: 190, status: "placed", reason: null, jobId: null, createdAt: minutesAgo(1), review: null, issues: [], discountRupees: 0, couponCode: null, scheduledFor: null },
  { id: "o2", code: "HX39PA", customerName: "Rahul Sahoo", customerPhone: "+919812345678", area: "Nayapalli", address: "B-14, CRP Square", lat: 20.29, lng: 85.81,
    note: null, items: [{ id: "b", name: "Idli (2 pcs)", priceRupees: 40, qty: 3, options: [] }], subtotalRupees: 120, deliveryRupees: 20, totalRupees: 140, status: "accepted", reason: null, jobId: null, createdAt: minutesAgo(12), review: null, issues: [], discountRupees: 0, couponCode: null, scheduledFor: null },
  { id: "o3", code: "R4TC9M", customerName: "Anita Behera", customerPhone: "+919800011122", area: "Patia", address: "KIIT Road, near Campus 6", lat: 20.35, lng: 85.82,
    note: null, items: [{ id: "a", name: "Masala dosa", priceRupees: 60, qty: 1, options: [] }], subtotalRupees: 60, deliveryRupees: 20, totalRupees: 80, status: "delivered", reason: null, jobId: "j", createdAt: minutesAgo(90),
    review: { stars: 4, comment: "Tasty, a little cold", photo_path: null, reply: null }, issues: [{ kind: "missing_item", details: "No chutney" }], discountRupees: 10, couponCode: "SAVE10", scheduledFor: null },
];
const month = new Date().toISOString().slice(0, 7) + "-01";
const SAMPLE_CHARGES: Charge[] = [
  { id: "c1", kind: "setup", amountRupees: 999, description: "Waggle Business set-up", period: month, status: "due", createdAt: minutesAgo(60 * 24 * 6), invoiceId: null },
  { id: "c2", kind: "plan", amountRupees: 999, description: "Growth plan, this month", period: month, status: "due", createdAt: minutesAgo(60 * 24 * 5), invoiceId: null },
];
const SAMPLE_INVOICE: Invoice = {
  id: "i1", number: "GZ/2026-27/00001", period: "2026-08-01", issuedAt: minutesAgo(60 * 24 * 20), taxMode: "gst", taxablePaise: 171186, cgstPaise: 15407, sgstPaise: 15407, igstPaise: 0, totalPaise: 202000,
  supplier: { name: "Gigzen", address: "Bhubaneswar, Odisha", gstin: "21AAAAA0000A1Z5", pan: null, state_code: "21", sac: "998599", email: null },
  recipient: { name: "Janpath Tiffins", owner: "Sunita Das", address: "Unit 3, Janpath, Bhubaneswar", gstin: "21ABCDE1234F1Z5", pan: "ABCDE1234F", state_code: "21" },
  lines: [{ description: "Waggle Business set-up", quantity: 1, rate_paise: 99900, amount_paise: 99900 }, { description: "Growth plan, August 2026", quantity: 1, rate_paise: 99900, amount_paise: 99900 }, { description: "Delivery routing fee", quantity: 22, rate_paise: 1000, amount_paise: 22000 }],
  status: "due",
};
const SAMPLE_REPORT: Report = {
  from: "2026-08-26", to: "2026-09-24",
  deliveries: { sent: 214, delivered: 201, cancelled: 6, in_progress: 3, avg_accept_min: 2.4, avg_ride_min: 14.8, fees_paise: 201000, fares: 7420, km: 690, by_source: { app: 120, order: 78, api: 16 } },
  orders: { placed: 92, delivered: 78, rejected: 6, sales_paise: 1482000, avg_order_paise: 19000 },
  days: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10), sent: 4 + ((i * 7) % 6), delivered: 4 + ((i * 7) % 5), orders: 2 + (i % 4), sales_paise: 30000 + i * 1000 })),
  areas: [{ area: "Saheed Nagar", count: 48 }, { area: "Nayapalli", count: 37 }, { area: "Patia", count: 29 }, { area: "Old Town", count: 12 }],
  top_items: [{ name: "Masala dosa", qty: 118, sales_paise: 708000 }, { name: "Idli (2 pcs)", qty: 74, sales_paise: 296000 }, { name: "Filter coffee", qty: 66, sales_paise: 165000 }],
};
const SAMPLE_ADS: AdCampaign[] = [
  { id: "ad1", name: "Dosa week", headline: "Crispy dosa, hot in 30 minutes", itemId: "a", budgetRupees: 300, startsOn: "2026-09-24", endsOn: null, status: "pending", reviewNote: null, createdAt: minutesAgo(30) },
];
const SAMPLE_KEYS: ApiKey[] = [{ id: "k1", name: "Website", prefix: "wgk_live_3f9a", createdAt: minutesAgo(600), lastUsedAt: minutesAgo(5), revokedAt: null }];
const SAMPLE_QUEUE_B: QueueBusiness[] = [
  { ...NEW_SHOP, id: "q1", ownerName: "Rakesh Sahoo", pan: "ABCPS1234K", aadhaarLast4: "9876", entityType: "proprietor", profileName: "Rakesh", profilePhone: "+91 90000 11111",
    missing: ["doc_shopfront", "payout", "proof", "gst"], requiredChecks: ["pan_name_matches", "aadhaar_masked", "selfie_matches", "shopfront_board", "proof_valid", "payout_name_matches"], licenceOk: true, lastReview: null },
  { ...SAMPLE_BUSINESS, id: "q3", status: "pending", profileName: "Sunita", profilePhone: "+91 90000 33333", missing: [],
    requiredChecks: ["pan_name_matches", "aadhaar_masked", "selfie_matches", "shopfront_board", "proof_valid", "payout_name_matches", "gstin_valid", "fssai_valid"], licenceOk: true, lastReview: null },
];
const SAMPLE_QUEUE_P: QueuePayment[] = [
  { id: "p1", invoiceId: "i1", amountRupees: 2020, utr: "412345678901", status: "submitted", reviewNote: null, createdAt: minutesAgo(90), businessName: "Janpath Tiffins", invoiceNumber: "GZ/2026-27/00001", dueRupees: 2020 },
];

function previewRoutes() {
  const nav = <BusinessNav admin base="/preview" newOrders={1} />;
  const noop = async () => undefined;
  return [
    <Route key="register" path="/preview/register" element={<RegisterBusinessScreen onSubmit={noop} />} />,
    <Route key="pending" path="/preview/pending" element={<PendingScreen business={NEW_SHOP} missing={["entity_type", "owner_name", "pan", "aadhaar", "doc_pan", "doc_aadhaar", "doc_selfie", "doc_shopfront", "payout"]} onRefresh={() => undefined} onVerify={() => undefined} />} />,
    <Route key="verify" path="/preview/verify" element={<VerifyBusinessScreen business={NEW_SHOP} onSaved={() => undefined} onBack={() => undefined} />} />,
    <Route key="home" path="/preview" element={<PreviewHome nav={nav} />} />,
    <Route key="home2" path="/preview/home" element={<PreviewHome nav={nav} />} />,
    <Route key="send" path="/preview/send" element={<SendDeliveryScreen business={SAMPLE_BUSINESS} onBack={() => undefined} onSend={noop} />} />,
    <Route key="orders" path="/preview/orders" element={<OrdersScreen business={SAMPLE_BUSINESS} orders={SAMPLE_ORDERS} nav={nav} onRespond={noop} onDispatch={noop} onSelfDelivered={noop} onCancel={noop} onSettings={noop} onReply={noop} />} />,
    <Route key="offers" path="/preview/offers" element={<OffersScreen business={SAMPLE_BUSINESS} coupons={[{ id: "cp1", code: "DOSA20", title: "20% off your dosa, up to Rs 40", kind: "percent", value: 20, minOrderPaise: 10000, maxDiscountPaise: 4000, firstOrderOnly: false, perPhoneLimit: 1, usageLimit: 200, startsAt: minutesAgo(600), endsAt: null, active: true }]} nav={nav} onSave={noop} />} />,
    <Route key="catalog" path="/preview/catalog" element={<CatalogScreen business={SAMPLE_BUSINESS} items={SAMPLE_ITEMS} nav={nav} onSave={noop} onRemove={noop} onUploadPhoto={async () => ""} />} />,
    <Route key="billing" path="/preview/billing" element={<BillingScreen business={SAMPLE_BUSINESS} charges={SAMPLE_CHARGES} invoices={[SAMPLE_INVOICE]} payments={[]} company={{ legalName: "Gigzen", address: "Bhubaneswar", gstin: null, upiId: "gigzen@okaxis", supportEmail: null }} nav={nav} onChangePlan={noop} onSubmitPayment={noop} />} />,
    <Route key="reports" path="/preview/reports" element={<ReportsScreen business={SAMPLE_BUSINESS} nav={nav} onLoad={async () => SAMPLE_REPORT} />} />,
    <Route key="ads" path="/preview/ads" element={<AdsScreen business={SAMPLE_BUSINESS} campaigns={SAMPLE_ADS} items={SAMPLE_ITEMS} spent={0} nav={nav} onSave={noop} onState={noop} />} />,
    <Route key="api" path="/preview/api" element={<ApiScreen business={SAMPLE_BUSINESS} keys={SAMPLE_KEYS} nav={nav} onCreate={async () => "wgk_live_" + "0".repeat(48)} onRevoke={noop} />} />,
    <Route key="more" path="/preview/more" element={<MoreScreen business={SAMPLE_BUSINESS} admin base="/preview" nav={nav} />} />,
    <Route key="business" path="/preview/business" element={<RegisterBusinessScreen initial={SAMPLE_BUSINESS} title="Business details" submitLabel="Save changes" nav={nav} onSubmit={noop} />} />,
    <Route key="admin" path="/preview/admin" element={<AdminScreen businesses={SAMPLE_QUEUE_B} workers={[]} payments={SAMPLE_QUEUE_P} ads={SAMPLE_ADS.map((a) => ({ ...a, businessName: "Janpath Tiffins", itemName: "Masala dosa" }))} nav={nav} docUrl={async () => null} onReviewBusiness={noop} onReviewWorker={noop} onReviewPayment={noop} onReviewAd={noop} onMonthEnd={async () => ({ invoices: 0, plan_charges: 0 })} runs={[{ period: "2026-08-01", ranAt: minutesAgo(60 * 24 * 23), invoices: 14, planCharges: 9, ranBy: null }]} />} />,
  ];
}

function PreviewHome({ nav }: { nav: JSX.Element }) {
  const navigate = useNavigate();
  return (
    <BusinessHomeScreen
      business={SAMPLE_BUSINESS}
      jobs={SAMPLE_JOBS}
      nav={nav}
      onSend={() => navigate("/preview/send")}
      onCancel={() => undefined}
      onPayee={async () => ({ name: "Subrat Kumar Nayak", upi: "subrat@okicici", fare: 77, paidAt: null, utr: null, disputedAt: null })}
      onMarkPaid={async () => undefined}
      sendPanel={<SendDeliveryForm business={SAMPLE_BUSINESS} onSend={async () => undefined} />}
    />
  );
}
