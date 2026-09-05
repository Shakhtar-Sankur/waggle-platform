import { Bell, Bike, Bookmark, CalendarDays, Globe, Pencil, Settings, Shield, ShieldOff, Trash2, Wallet, Wrench, Camera } from "lucide-react";
import { WorkAppMark } from "../components/WorkAppMark";
import { VehicleIcon } from "../components/VehicleIcon";
import type { ReactNode } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { GigzenByline } from "../components/GigzenMark";
import { Wordmark } from "../components/Wordmark";
import { COMPANY_SITE } from "../config/constants";
import { FULL_COVERAGE, LANGUAGES, coverageOf, useLangStore, useT, type Lang } from "../i18n";
import { resolveCountryForLocation } from "../i18n/region";
import { useBrandBand } from "../hooks/useBrandBand";
import { MediaService } from "../services/MediaService";
import { SupabaseService } from "../services/SupabaseService";
import { localAppCount, workAppsForCountry } from "../utils/workApps";
import { useAuthStore } from "../stores/useAuthStore";
import { useCommunityStore } from "../stores/useCommunityStore";
import { useLocationStore } from "../stores/useLocationStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import { useProfileStore } from "../stores/useProfileStore";
import type { ProfileSettings, VehicleType } from "../types";
import { CURRENCIES, currency, initials, km } from "../utils/format";

type EarningsTab = "day" | "week" | "month";

export function ProfileScreen() {
  useBrandBand("profile");
  const navigate = useNavigate();
  const t = useT();
  const [searchParams] = useSearchParams();
  // For localising weekday names in the 7-day record, below.
  const lang = useLangStore((state) => state.lang);
  const blocked = useCommunityStore((state) => state.blocked);
  const workers = useCommunityStore((state) => state.workers);
  const bookmarks = useCommunityStore((state) => state.bookmarks);
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const signOut = useAuthStore((state) => state.signOut);
  const deleteAccount = useAuthStore((state) => state.deleteAccount);
  const profile = useProfileStore();
  const setActiveApp = useProfileStore((state) => state.setActiveApp);
  const updateSettings = useProfileStore((state) => state.updateSettings);
  const logMaintenance = useProfileStore((state) => state.logMaintenance);
  const totalDistanceKm = useLocationStore((state) => state.totalDistanceKm);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Profile photo. The avatar_url column has existed all along with nothing in
  // the app able to set it, so every driver was an initials circle.
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const changeAvatar = async () => {
    const picked = await MediaService.pickImage();
    if (!picked || !user) return;
    setAvatarBusy(true);
    // Show it immediately; the stored URL replaces the local preview once the
    // upload lands, so a slow connection never leaves the driver staring at
    // their old photo wondering whether the tap registered.
    setAvatarUrl(picked.preview);
    try {
      const url = await SupabaseService.setAvatar(user.id, picked);
      setAvatarUrl(url);
    } catch {
      setAvatarUrl(undefined);
    } finally {
      setAvatarBusy(false);
    }
  };
  const [tab, setTab] = useState<EarningsTab>("week");
  const [showAllApps, setShowAllApps] = useState(false);

  /* The last seven days of real driving, read back from route_points.
     `null` means "not loaded yet" and is deliberately distinct from an empty
     week: a driver who has not driven must see seven empty days, not a
     spinner that never resolves. */
  /* Thirty days, because the earnings report's Month tab is measured from this
     too. The 7-day list below is the tail of the same fetch rather than a
     second query — one read, two views, and they cannot disagree. */
  const [history, setHistory] = useState<{ day: string; km: number }[] | null>(null);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    SupabaseService.routeHistory(30)
      .then((rows) => { if (!cancelled) setHistory(rows); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
    // Re-read after a trip ends, so the day's bar is not stale until a reload.
  }, [user, totalDistanceKm === 0]);

  /* Weekday names must follow the language the driver PICKED, not the one the
     handset happens to be set to. Passing undefined as the locale reads the
     browser's language, which left "Sat Sun Mon" sitting in the middle of an
     otherwise fully Korean screen.
     Wrapped because a tag Intl does not recognise throws, and a driver should
     lose the localised weekday, not the whole screen. */
  const dayFormatter = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(lang, { weekday: "short" });
    } catch {
      return new Intl.DateTimeFormat(undefined, { weekday: "short" });
    }
  }, [lang]);

  const last7 = useMemo(() => (history ?? []).slice(-7), [history]);
  const weekKm = useMemo(() => last7.reduce((sum, d) => sum + d.km, 0), [last7]);
  const monthKm = useMemo(
    () => (history ?? []).reduce((sum, d) => sum + d.km, 0),
    [history],
  );
  const busiestKm = useMemo(
    () => Math.max(1, ...last7.map((d) => d.km)),   // never divide by 0
    [last7],
  );

  /* What the Earnings Report shows for the selected tab.
     Day stays on the live store so this card and the home screen always agree;
     week and month come from the record. They used to be today multiplied by 7
     and 30, which is not a report of anything. */
  const periodKm = tab === "day" ? totalDistanceKm : tab === "week" ? weekKm : monthKm;
  const periodLabel =
    tab === "day" ? t("earnings_today")
    : tab === "week" ? t("earnings_recorded")
    : t("earnings_recordedMonth");

  // 30+ platforms would swamp this screen, so show the ones operating in the
  // driver's country (plus whatever they already picked) and hide the rest
  // behind a toggle.
  const country = useMemo(() => resolveCountryForLocation(), []);
  const orderedApps = useMemo(() => workAppsForCountry(country), [country]);
  const nearbyCount = useMemo(() => localAppCount(country), [country]);
  const appChoices = useMemo(() => {
    if (showAllApps) return orderedApps;
    const shortlist = orderedApps.slice(0, Math.max(nearbyCount, 5));
    const selected = orderedApps.find((app) => app.id === profile.activeApp);
    const others = orderedApps.filter((app) => app.id === "others");
    const list = [...shortlist];
    if (selected && !list.includes(selected)) list.push(selected);
    others.forEach((o) => {
      if (!list.includes(o)) list.push(o);
    });
    return list;
  }, [showAllApps, orderedApps, nearbyCount, profile.activeApp]);
  const hiddenAppCount = orderedApps.length - appChoices.length;

  useEffect(() => {
    if (searchParams.get("settings") === "true") setSettingsOpen(true);
  }, [searchParams]);

  return (
    <main className="page-shell profile-page has-band">
      {/* Same band as Home. The avatar used to float on near-white with the
          title above it on nothing; on colour it reads as a profile header
          rather than a lone circle. */}
      <section className="screen-band profile-band">
      <section className="profile-hero">
        <button
          type="button"
          className="avatar huge pf-avatar-btn"
          onClick={() => void changeAvatar()}
          aria-label={t("pf_changePhoto")}
          disabled={avatarBusy}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="pf-avatar-img" />
          ) : (
            initials(user?.fullName ?? "Driver")
          )}
          <span className="pf-avatar-edit"><Camera size={15} /></span>
        </button>
        <h2>{user?.fullName}</h2>
      </section>
      </section>

      <section>
        <h3 className="profile-section-title">{t("profile_whichApp")}</h3>
        <div className="profile-app-grid">
          {appChoices.map((app) => (
            <button
              key={app.id}
              className={profile.activeApp === app.id ? "selected" : ""}
              onClick={() => setActiveApp(app.id)}
            >
              <WorkAppMark app={app} size={30} />
              <small>{app.name}</small>
              {profile.activeApp === app.id ? <em /> : null}
            </button>
          ))}
        </div>
        {hiddenAppCount > 0 ? (
          <button className="profile-app-more" onClick={() => setShowAllApps((v) => !v)}>
            {showAllApps
              ? t("profile_showFewerApps")
              : t("profile_showAllApps", { count: String(hiddenAppCount) })}
          </button>
        ) : null}
      </section>

      <button className="settings-row glass-card" onClick={() => setSettingsOpen(true)}>
        <span><Settings size={18} /> {t("profile_settings")}</span>
        <small>{t("profile_settingsSub")}</small>
      </button>

      <section className="dashboard-card glass-card maintenance-card">
        <div className="section-heading">
          <h3><Wrench size={19} /> {t("profile_maintenance")}</h3>
          <span className={profile.maintenanceKm >= 900 ? "badge-dark" : "pill"}>{profile.maintenanceKm >= 900 ? t("profile_attention") : t("profile_good")}</span>
        </div>
        <p>{t(`vehicle_${profile.vehicleType}` as "vehicle_car")}</p>
        <small>
          {profile.maintenanceKm >= 1000
            ? t("profile_serviceOverdue")
            : t("profile_nextService", {
                // Round: maintenanceKm now accumulates real GPS distance, so an
                // unrounded value rendered as "998.51768046523 km".
                km: String(Math.max(0, Math.round(1000 - profile.maintenanceKm))),
              })}
        </small>
        <div className="maintenance-scale">
          <div className="progress-track">
            <span style={{ width: `${Math.min(100, (profile.maintenanceKm / 1000) * 100)}%` }} />
          </div>
          <div><span>0 km</span><span>500 km</span><span>1000 km</span></div>
        </div>
        <Button variant="outline" onClick={logMaintenance}>{t("profile_logMaintenance")}</Button>
      </section>

      <section className="dashboard-card glass-card">
        <div className="section-heading">
          <h3>{t("profile_earningsReport")}</h3>
          <div className="mini-tabs">
            {(["day", "week", "month"] as EarningsTab[]).map((item) => (
              <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
                {t(`common_${item}` as "common_day")}
              </button>
            ))}
          </div>
        </div>
        <div className="earnings-report">
          <p>{periodLabel}</p>
          <strong>{currency(periodKm * profile.baseRate)}</strong>
          <span>{km(periodKm)}</span>
          {/* The week and month figures are read back from the server, so say
              so while they are still arriving rather than flashing a confident
              0 km that then jumps. */}
          {tab !== "day" ? (
            <small className="earnings-note">
              {history === null ? t("history_loading") : t("earnings_recordedNote")}
            </small>
          ) : null}
        </div>
      </section>

      {/* A real record, unlike the projection above it: every figure here is
          measured from the driver's own recorded fixes. */}
      <section className="dashboard-card glass-card">
        <div className="section-heading">
          <h3><CalendarDays size={19} /> {t("history_last7")}</h3>
          <span className="pill">{km(weekKm)}</span>
        </div>
        {history === null ? (
          <p className="micro-copy">{t("history_loading")}</p>
        ) : (
          <div className="week-history">
            {last7.map((d) => {
              // Parsed as local parts, not Date(string): "2026-09-04" is parsed
              // as UTC midnight, which lands on the previous day west of London
              // and would label every bar with the wrong weekday.
              const [y, m, day] = d.day.split("-").map(Number);
              const date = new Date(y, m - 1, day);
              const isToday = date.toDateString() === new Date().toDateString();
              return (
                <div className={`week-history-row${isToday ? " today" : ""}`} key={d.day}>
                  <span className="week-history-day">
                    {dayFormatter.format(date)}
                  </span>
                  <div className="week-history-track">
                    <span style={{ width: `${Math.round((d.km / busiestKm) * 100)}%` }} />
                  </div>
                  <span className="week-history-km">{km(d.km)}</span>
                </div>
              );
            })}
          </div>
        )}
        <small className="earnings-note">{t("history_note")}</small>
      </section>

      {/* One way in to everything the driver has done. This replaced a
          standalone "Blocked users" card: two places answering "what have I
          done here" is how a Blocked list ends up somewhere nobody looks, and
          saved posts end up with no home at all. Blocked is now a tab there. */}
      <section className="dashboard-card glass-card activity-entry">
        <div className="section-heading">
          <h3><Bookmark size={19} /> {t("act_title")}</h3>
          {bookmarks.length || blocked.length ? (
            <span className="pill">{bookmarks.length + blocked.length}</span>
          ) : null}
        </div>
        <p className="micro-copy">{t("act_sub")}</p>
        <Button variant="outline" className="wide-action" onClick={() => navigate("/activity")}>
          {t("act_title")}
        </Button>
      </section>

      <Button className="wide-action" onClick={() => setEditOpen(true)}><Pencil size={18} /> {t("profile_editProfile")}</Button>
      <Button
        variant="outline"
        className="wide-action"
        onClick={() => {
          signOut();
          navigate("/auth");
        }}
      >
        {t("profile_logOut")}
      </Button>

      <section className="legal-links">
        <Link to="/privacy">{t("consent_privacyPolicy")}</Link>
        <Link to="/terms">{t("consent_terms")}</Link>
      </section>

      {/* The app name appears on Home and here. Community and Routes carry the
          bee alone, so the name is stated where someone looks for it rather
          than repeated on every screen. */}
      <div className="profile-brand">
        {/* Default tone, not solid: the solid variant renders the bee in the
            text colour, which made the logo black here. The bee is orange. */}
        <Wordmark size={27} />
      </div>

      <a className="gigzen-link" href={COMPANY_SITE} target="_blank" rel="noreferrer">
        <GigzenByline />
      </a>

      <Button variant="outline" className="wide-action danger-action" onClick={() => setDeleteOpen(true)}>
        <Trash2 size={18} /> {t("profile_deleteAccount")}
      </Button>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} profile={profile} onSave={updateSettings} />
      <EditProfileModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        fullName={user?.fullName ?? ""}
        phone={user?.phone ?? ""}
        onSave={(updates) => updateProfile(updates)}
      />
      <DeleteAccountModal
        open={deleteOpen}
        deleting={deleting}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await deleteAccount();
            setDeleteOpen(false);
            navigate("/auth");
          } finally {
            setDeleting(false);
          }
        }}
      />
    </main>
  );
}

function SettingsModal({
  open,
  onClose,
  profile,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  profile: ProfileSettings;
  onSave: (settings: Partial<ProfileSettings>) => void;
}) {
  const t = useT();
  const notifPrefs = useNotificationStore((state) => state.prefs);
  const setNotifPref = useNotificationStore((state) => state.setPref);
  const lang = useLangStore((state) => state.lang);
  const setLang = useLangStore((state) => state.setLang);
  const autoRegion = useLangStore((state) => state.autoRegion);
  const setAutoRegion = useLangStore((state) => state.setAutoRegion);
  const [vehicleType, setVehicleType] = useState<VehicleType>(profile.vehicleType);
  const [homeAddress, setHomeAddress] = useState(profile.homeAddress);
  const [baseRate, setBaseRate] = useState(String(profile.baseRate));
  const [dailyGoal, setDailyGoal] = useState(String(profile.dailyGoal));
  const [shareStats, setShareStats] = useState(profile.shareStats);
  const [currencyCode, setCurrencyCode] = useState(profile.currencyCode);

  useEffect(() => {
    setVehicleType(profile.vehicleType);
    setHomeAddress(profile.homeAddress);
    setBaseRate(String(profile.baseRate));
    setDailyGoal(String(profile.dailyGoal));
    setShareStats(profile.shareStats);
    setCurrencyCode(profile.currencyCode);
  }, [profile.baseRate, profile.dailyGoal, profile.homeAddress, profile.shareStats, profile.vehicleType, profile.currencyCode, open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      vehicleType,
      homeAddress,
      baseRate: Number(baseRate) || profile.baseRate,
      /* A goal of 0 would divide by zero in the progress line, and a negative
         one is meaningless, so an unusable entry keeps the previous goal rather
         than being written. Same shape as baseRate above. */
      dailyGoal: Number(dailyGoal) > 0 ? Number(dailyGoal) : profile.dailyGoal,
      shareStats,
      // Only persist a manual currency when auto mode is off.
      ...(autoRegion ? {} : { currencyCode }),
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("profile_settings")}
      description={t("settings_sub")}
    >
      {/* Grouped rather than one flat list of label+control. Eight unrelated
          settings stacked at the same weight gave a driver nothing to scan
          by — where a setting lives is half of finding it. Four groups, each
          named, each with the icon doing the same job as the heading. */}
      <form className="settings-form" onSubmit={submit}>
        <section className="settings-group">
          <h4><Globe size={15} /> {t("settings_grpRegion")}</h4>
          <label className="toggle-row">
            <span>{t("settings_autoRegion")}</span>
            <input type="checkbox" checked={autoRegion} onChange={(event) => setAutoRegion(event.target.checked)} />
          </label>
          <label>
            <span>{t("settings_language")}</span>
            <select value={lang} onChange={(event) => setLang(event.target.value as Lang)}>
              {/* Twenty-seven of the forty-three cover the core screens and
                  fall back to English for the rest. Saying so here costs one
                  clause and stops the surprise happening after the choice. */}
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {coverageOf(l.code) < FULL_COVERAGE
                    ? `${l.label} — ${t("settings_langPartial")}`
                    : l.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("settings_currency")}</span>
            <select
              value={autoRegion ? profile.currencyCode : currencyCode}
              disabled={autoRegion}
              onChange={(event) => setCurrencyCode(event.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.symbol} · {c.label} ({c.code})</option>
              ))}
            </select>
            {/* Say why it is greyed out, instead of leaving a dead control. */}
            {autoRegion ? <small className="settings-hint">{t("settings_currencyAuto")}</small> : null}
          </label>
        </section>

        <section className="settings-group">
          <h4><Bike size={15} /> {t("settings_grpVehicle")}</h4>
        <label>
          <span>{t("settings_vehicle")}</span>
          <div className="vehicle-picker">
            {/* Drawn icons, not emoji. Emoji are rendered by the platform, so
                the picker was colour clip-art on one phone and a flat outline
                on another, in a sheet where everything else is a line icon.
                See VehicleIcon for why lucide could not supply these. */}
            <VehicleButton value="car" selected={vehicleType} onSelect={setVehicleType} icon={<VehicleIcon type="car" size={26} />} label={t("vehicle_car")} />
            <VehicleButton value="motorcycle" selected={vehicleType} onSelect={setVehicleType} icon={<VehicleIcon type="motorcycle" size={26} />} label={t("vehicle_motorcycle")} />
            <VehicleButton value="bicycle" selected={vehicleType} onSelect={setVehicleType} icon={<VehicleIcon type="bicycle" size={26} />} label={t("vehicle_bicycle")} />
          </div>
        </label>
        </section>

        <section className="settings-group">
          <h4><Wallet size={15} /> {t("settings_grpWork")}</h4>
          <label>
            <span>{t("settings_homeAddress")}</span>
            <input value={homeAddress} onChange={(event) => setHomeAddress(event.target.value)} placeholder={t("settings_homeAddressPh")} />
          </label>
          <label>
            <span>{t("settings_baseRate")}</span>
            <input value={baseRate} onChange={(event) => setBaseRate(event.target.value)} inputMode="decimal" placeholder={t("settings_baseRatePh")} />
          </label>
          <label className="settings-row">
            {/* home_dailyGoal, not a new key: "Daily Goal" is already
                translated in all 43 dictionaries (it labelled the goal card
                that used to sit on the home screen) and was left unused when
                that card went. Reusing it means this row is translated
                everywhere on day one, and it matches the wording of the home
                screen's "% of your ₹1,500 daily goal". */}
            <span>{t("home_dailyGoal")}</span>
            <input value={dailyGoal} onChange={(event) => setDailyGoal(event.target.value)} inputMode="decimal" placeholder={t("settings_dailyGoalPh")} />
          </label>
        </section>

        <section className="settings-group">
          <h4><Bell size={15} /> {t("notifPrefs_group")}</h4>
          {/* Four categories, each independently switchable. Account and
              security notices are deliberately not here — an app that lets you
              mute those has a worse problem than an unwanted notification.
              The server checks these before sending, because Android shows an
              FCM notification payload itself and the app never gets a say. */}
          {([
            ["chat", "notifPrefs_chat", "notifPrefs_chatSub"],
            ["social", "notifPrefs_social", "notifPrefs_socialSub"],
            ["location", "notifPrefs_location", "notifPrefs_locationSub"],
            ["promo", "notifPrefs_promo", "notifPrefs_promoSub"],
          ] as const).map(([key, label, sub]) => (
            <label className="settings-row settings-toggle" key={key}>
              <span>
                {t(label)}
                <small className="settings-hint">{t(sub)}</small>
              </span>
              <input
                type="checkbox"
                checked={notifPrefs[key]}
                onChange={(event) => void setNotifPref(key, event.target.checked).catch(() => {})}
              />
            </label>
          ))}
          <small className="settings-hint">{t("notifPrefs_always")}</small>

          <h4><Shield size={15} /> {t("settings_grpPrivacy")}</h4>
          <label className="toggle-row">
            <span>{t("settings_shareStats")}</span>
            <input type="checkbox" checked={shareStats} onChange={(event) => setShareStats(event.target.checked)} />
          </label>
        </section>

        <Button>{t("common_save")}</Button>
      </form>
    </Modal>
  );
}

function VehicleButton({
  value,
  selected,
  onSelect,
  icon,
  label,
}: {
  value: VehicleType;
  selected: VehicleType;
  onSelect: (value: VehicleType) => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button type="button" className={selected === value ? "selected" : ""} onClick={() => onSelect(value)}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function EditProfileModal({
  open,
  onClose,
  fullName,
  phone,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  fullName: string;
  phone: string;
  onSave: (updates: { fullName: string; phone: string }) => void;
}) {
  const t = useT();
  const [name, setName] = useState(fullName);
  const [phoneNumber, setPhoneNumber] = useState(phone);

  useEffect(() => {
    setName(fullName);
    setPhoneNumber(phone);
  }, [fullName, phone, open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ fullName: name, phone: phoneNumber });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("profile_editProfileTitle")} description={t("profile_editProfileSub")}>
      <form className="settings-form" onSubmit={submit}>
        <label>
          <span>{t("profile_fullName")}</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>{t("profile_phoneNumber")}</span>
          <input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} />
        </label>
        <Button>{t("common_saveChanges")}</Button>
      </form>
    </Modal>
  );
}

function DeleteAccountModal({
  open,
  deleting,
  onClose,
  onConfirm,
}: {
  open: boolean;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (open) setConfirmed(false);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("profile_deleteAccount")}
      description={t("profile_deleteAccountSub")}
    >
      <div className="settings-form">
        <label className="consent-checkbox">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>{t("profile_deleteConfirm")}</span>
        </label>
        <Button variant="outline" className="danger-action" disabled={!confirmed || deleting} onClick={() => void onConfirm()}>
          {deleting ? t("profile_deleting") : t("profile_deleteMyAccount")}
        </Button>
      </div>
    </Modal>
  );
}
