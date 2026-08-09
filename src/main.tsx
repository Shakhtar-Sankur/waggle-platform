import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import { Monitoring } from "./services/Monitoring";
import { Outbox } from "./services/Outbox";
import "./fonts.css";
import "./styles.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
