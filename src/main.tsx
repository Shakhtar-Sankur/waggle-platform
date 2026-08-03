import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
