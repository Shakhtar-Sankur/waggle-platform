import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import { Monitoring } from "./services/Monitoring";
import { Outbox } from "./services/Outbox";
import "./fonts.css";
import "./styles.css";
import App from "./App";
import BusinessApp from "./business/BusinessApp";
import WaggleApp from "./waggle/WaggleApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { APP_FLAVOR } from "./config/constants";

// One code base, two apps: the build mode decides which one this is.
const Root = APP_FLAVOR === "business" ? BusinessApp : APP_FLAVOR === "waggle" ? WaggleApp : App;
if (APP_FLAVOR === "business") document.title = "Waggle Business";
if (APP_FLAVOR === "waggle") document.title = "Waggle";
import { applyDirection } from "./i18n";

// Apply the saved text direction before first paint to avoid a flash.
try {
  const rawLang = localStorage.getItem("masaya_lang");
  const lang = rawLang ? JSON.parse(rawLang).state?.lang ?? "en" : "en";
  applyDirection(lang);
} catch {
  applyDirection("en");
}

// Before anything else, so a crash during startup is still reported.
Monitoring.init();

// Anything a driver wrote while offline goes out as soon as there is signal.
Outbox.start();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
