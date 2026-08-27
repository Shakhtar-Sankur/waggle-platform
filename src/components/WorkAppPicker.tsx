import { Search } from "lucide-react";
import { WorkAppMark } from "./WorkAppMark";
import { useMemo, useState } from "react";
import { useT } from "../i18n";
import { resolveCountry } from "../i18n/region";
import { useProfileStore } from "../stores/useProfileStore";
import type { WorkAppId } from "../types";
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
  const country = useMemo(() => resolveCountry(), []);
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

      {/* Platforms operating where the driver is come first. */}
      {!query && localCount > 0 ? (
        <p className="app-group-label">{t("picker_nearYou")}</p>
      ) : null}

      {apps.length ? (
        <div className="app-choice-grid scrollable">
          {apps.map((app) => (
            <button
              className={`app-choice ${activeApp === app.id ? "selected" : ""}`}
              key={app.id}
              onClick={() => selectApp(app.id)}
            >
              <WorkAppMark app={app} size={30} />
              <strong>{app.name}</strong>
            </button>
          ))}
        </div>
      ) : (
        <p className="app-choice-empty">{t("picker_noMatch")}</p>
      )}
    </Modal>
  );
}
