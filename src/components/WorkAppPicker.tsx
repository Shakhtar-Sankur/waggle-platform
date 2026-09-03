import { Search } from "lucide-react";
import { WorkAppMark } from "./WorkAppMark";
import { useMemo, useState } from "react";
import { useT } from "../i18n";
import { resolveCountryForLocation } from "../i18n/region";
import { useProfileStore } from "../stores/useProfileStore";
import type { WorkApp, WorkAppId } from "../types";
import { localAppCount, searchWorkApps } from "../utils/workApps";
import { Modal } from "./ui/Modal";

interface WorkAppPickerProps {
  open: boolean;
  onClose: () => void;
}

export function WorkAppPicker({ open, onClose }: WorkAppPickerProps) {
  const t = useT();
  const activeApp = useProfileStore((state) => state.activeApp);
  const setActiveApp = useProfileStore((state) => state.setActiveApp);
  const [query, setQuery] = useState("");

  // Platforms operating in the driver's country are listed first.
  // Which platforms exist here is a fact about here, not about what the
  // handset reads. This asked the locale, so an Indian driver on an en-US
  // phone was shown US platforms under the heading "Available where you are".
  const country = useMemo(() => resolveCountryForLocation(), []);
  const apps = useMemo(() => searchWorkApps(query, country), [query, country]);
  const localCount = useMemo(() => localAppCount(country), [country]);

  const selectApp = (id: WorkAppId) => {
    setActiveApp(id);
    setQuery("");
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("picker_title")} description="">
      <div className="app-search input-shell">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("picker_search")}
        />
      </div>

      {/* workAppsForCountry returns local platforms first, then the rest — so
          the first localCount entries are the ones that actually operate here.
          The heading used to sit above the WHOLE grid, which meant a driver in
          New York read "Available where you are" over Angkas, a Manila
          motorcycle service, and BigBasket, an Indian grocer. The list was
          right; the label was covering things it did not describe.

          While a search is running the split is dropped: the driver typed a
          name, and the answer is matches, not geography. */}
      {apps.length ? (
        <>
          {!query && localCount > 0 ? (
            <>
              <p className="app-group-label">{t("picker_nearYou")}</p>
              <AppGrid apps={apps.slice(0, localCount)} activeApp={activeApp} onPick={selectApp} />
              {apps.length > localCount ? (
                <>
                  <p className="app-group-label">{t("picker_elsewhere")}</p>
                  <AppGrid apps={apps.slice(localCount)} activeApp={activeApp} onPick={selectApp} />
                </>
              ) : null}
            </>
          ) : (
            <AppGrid apps={apps} activeApp={activeApp} onPick={selectApp} />
          )}
        </>
      ) : (
        <p className="app-choice-empty">{t("picker_noMatch")}</p>
      )}
    </Modal>
  );
}

/** One grid of platform tiles. Extracted only so the two halves of the split
 *  list cannot drift apart in styling or behaviour. */
function AppGrid({
  apps,
  activeApp,
  onPick,
}: {
  apps: WorkApp[];
  /** null when the driver has not chosen one yet — a new account has no app. */
  activeApp: WorkAppId | null;
  onPick: (id: WorkAppId) => void;
}) {
  return (
    <div className="app-choice-grid scrollable">
      {apps.map((app) => (
        <button
          className={`app-choice ${activeApp === app.id ? "selected" : ""}`}
          key={app.id}
          onClick={() => onPick(app.id)}
        >
          <WorkAppMark app={app} size={30} />
          <strong>{app.name}</strong>
        </button>
      ))}
    </div>
  );
}
