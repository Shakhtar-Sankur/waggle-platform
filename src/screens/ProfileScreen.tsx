import { BadgeCheck, Bell, Bike, Bookmark, Globe, Pencil, Settings, Shield, Trash2, Wrench, Camera } from "lucide-react";
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
import { useLangStore, useT } from "../i18n";
import { resolveCountryForLocation } from "../i18n/region";
import { useBrandBand } from "../hooks/useBrandBand";
import { MediaService } from "../services/MediaService";
import { RatingService, type RiderStanding } from "../services/RatingService";
import { SupabaseService } from "../services/SupabaseService";
import { localAppCount, workAppLabel, workAppsForCountry } from "../utils/workApps";
import { useAuthStore } from "../stores/useAuthStore";
import { useCommunityStore } from "../stores/useCommunityStore";
import { useLocationStore } from "../stores/useLocationStore";
import { useNotificationStore } from "../stores/useNotificationStore";
import { useProfileStore } from "../stores/useProfileStore";
import { useVerificationStore } from "../stores/useVerificationStore";
import type { ProfileSettings, VehicleType } from "../types";
import { CURRENCIES, currency, initials, km } from "../utils/format";

export function ProfileScreen() {
  useBrandBand("profile");
  const navigate = useNavigate();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const blocked = useCommunityStore((state) => state.blocked);
  const bookmarks = useCommunityStore((state) => state.bookmarks);
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const signOut = useAuthStore((state) => state.signOut);
  const deleteAccount = useAuthStore((state) => state.deleteAccount);
  const profile = useProfileStore();
  const verifiedVehicle = useVerificationStore((state) => state.verification?.vehicle);
  const updateSettings = useProfileStore((state) => state.updateSettings);
  const logMaintenance = useProfileStore((state) => state.logMaintenance);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Profile photo. The avatar_url column has existed all along with nothing in
  // the app able to set it, so every driver was an initials circle.
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [avatarBusy, setAvatarBusy] = useState(false);

  // Read back whatever photo the driver set last time. Without this the upload
  // only lasted until the next reload.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    SupabaseService.loadAvatar(user.id)
      .then((url) => { if (!cancelled && url) setAvatarUrl(url); })
      .catch(() => { /* an initials circle is a fine fallback */ });
    return () => { cancelled = true; };
  }, [user?.id]);

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
  useEffect(() => {
    if (searchParams.get("settings") === "true") setSettingsOpen(true);
  }, [searchParams]);

  /**
   * Close the settings sheet AND drop the ?settings=true that opened it.
   *
   * The header gear and the Home journey card both open settings by navigating
   * to /profile?settings=true. Leaving the parameter behind meant the next tap
   * navigated to the URL the app was already on: no change to searchParams, so
   * the effect above never re-ran and the sheet never reopened. Settings became
   * unreachable from the gear until a reload.
   *
   * replace, not push, so Back does not land on the URL that reopens it.
   */
  const closeSettings = () => {
    setSettingsOpen(false);
    if (searchParams.has("settings")) {
      const next = new URLSearchParams(searchParams);
      next.delete("settings");
      setSearchParams(next, { replace: true });
    }
  };

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

      <RiderCard />

      <button className="settings-row glass-card" onClick={() => setSettingsOpen(true)}>
        <span><Settings size={18} /> {t("profile_settings")}</span>
        <small>{t("profile_settingsSub")}</small>
      </button>

      <section className="dashboard-card glass-card maintenance-card">
        <div className="section-heading">
          <h3><Wrench size={19} /> {t("profile_maintenance")}</h3>
          <span className={profile.maintenanceKm >= 900 ? "badge-dark" : "pill"}>{profile.maintenanceKm >= 900 ? t("profile_attention") : t("profile_good")}</span>
        </div>
        {/* The vehicle Gigzen verified, when there is one; the settings choice otherwise. */}
        <p>{verifiedVehicle ? t(`gg_veh_${verifiedVehicle}` as "gg_veh_bike") : t(`vehicle_${profile.vehicleType}` as "vehicle_car")}</p>
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
          {/* dir="ltr" for the same reason the formatters isolate their output:
              in Arabic these three split into "km 0", "km 500", "km 1000". */}
          <div dir="ltr"><span>0 km</span><span>500 km</span><span>1000 km</span></div>
        </div>
        <Button variant="outline" onClick={logMaintenance}>{t("profile_logMaintenance")}</Button>
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

      <Button variant="outline" className="wide-action danger-action" onClick={() => setDeleteOpen(true)}>
        <Trash2 size={18} /> {t("profile_deleteAccount")}
      </Button>

      {/* The app name appears on Home and here. Community and Routes carry the
          bee alone, so the name is stated where someone looks for it rather
          than repeated on every screen.
          It closes the page, below the last action: sitting above Delete
          Account it read as the end of the screen, leaving the most
          destructive button stranded underneath the sign-off. */}
      <div className="profile-brand">
        {/* Default tone, not solid: the solid variant renders the bee in the
            text colour, which made the logo black here. The bee is orange. */}
        <Wordmark size={27} />
      </div>

      <a className="gigzen-link" href={COMPANY_SITE} target="_blank" rel="noreferrer">
        <GigzenByline />
      </a>

      <SettingsModal open={settingsOpen} onClose={closeSettings} profile={profile} onSave={updateSettings} />
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
  const autoRegion = useLangStore((state) => state.autoRegion);
  const setAutoRegion = useLangStore((state) => state.setAutoRegion);
  const [vehicleType, setVehicleType] = useState<VehicleType>(profile.vehicleType);
  const [shareStats, setShareStats] = useState(profile.shareStats);
  const [currencyCode, setCurrencyCode] = useState(profile.currencyCode);

  useEffect(() => {
    setVehicleType(profile.vehicleType);
    setShareStats(profile.shareStats);
    setCurrencyCode(profile.currencyCode);
  }, [profile.shareStats, profile.vehicleType, profile.currencyCode, open]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      vehicleType,
      shareStats,
      /* The toggle itself is saved either way — it is the thing that says
         whether region detection is allowed to overwrite the code, so it has to
         travel with the driver rather than living on one handset. The code is
         only written when auto is off, because in auto mode it is a detection
         result rather than a choice. */
      currencyAuto: autoRegion,
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

/** Who Gigzen verified: status, vehicle, plate and the UPI ID shops pay into. */
function RiderCard() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const verification = useVerificationStore((state) => state.verification);
  const load = useVerificationStore((state) => state.load);
  useEffect(() => { if (user) void load(user.id); }, [user, load]);
  const [standing, setStanding] = useState<RiderStanding | null>(null);
  useEffect(() => { if (user) void RatingService.mine().then(setStanding).catch(() => undefined); }, [user]);
  const v = verification;
  const status = v?.status ?? "none";
  const masked = (upi: string) => { const [name, bank] = upi.split("@"); return `${name.slice(0, 2)}${"•".repeat(Math.max(2, name.length - 2))}@${bank ?? ""}`; };
  return (
    <section className={`dashboard-card glass-card gg-ridercard is-${status}`}>
      <div className="section-heading">
        <h3><BadgeCheck size={19} /> {t("gg_riderCard")}</h3>
        <span className={`gg-vstatus is-${status}`}>{t(`gg_v_${status}` as "gg_v_none")}</span>
      </div>
      {v ? (
        <dl className="gg-facts">
          <div><dt>{t("gg_legalName")}</dt><dd>{v.legalName}</dd></div>
          <div><dt>{t("gg_vehicle")}</dt><dd>{t(`gg_veh_${v.vehicle}` as "gg_veh_bike")}{v.vehicleNumber ? ` · ${v.vehicleNumber}` : ""}</dd></div>
          <div><dt>{t("gg_payInto")}</dt><dd>{masked(v.upiId)}</dd></div>
          {status === "verified" ? (
            <div><dt>{t("gg_rating")}</dt><dd>{standing?.avg ? t("gg_ratingValue", { avg: standing.avg.toFixed(1), count: String(standing.count) }) : t("gg_ratingNone")}</dd></div>
          ) : null}
        </dl>
      ) : (
        <p className="micro-copy">{t("ver_cardBody")}</p>
      )}
      {standing?.count ? (
        <div className="gg-starbars" aria-label={t("gg_rating")}>
          {(["5", "4", "3", "2", "1"] as const).map((s) => (
            <div key={s}>
              <span>{s} ★</span>
              <i><b style={{ width: `${Math.round((standing.stars[s] / standing.count) * 100)}%` }} /></i>
              <small>{standing.stars[s]}</small>
            </div>
          ))}
          <p className="micro-copy">{t("gg_ratingPrivate")}</p>
        </div>
      ) : null}
      {status === "none" || status === "rejected" ? (
        <Button className="wide-action" onClick={() => navigate("/verify")}>{t(status === "rejected" ? "ver_fix" : "ver_cardButton")}</Button>
      ) : (
        <p className="micro-copy">{t("gg_changeDocs")}</p>
      )}
    </section>
  );
}
