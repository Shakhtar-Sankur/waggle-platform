import { translate } from "../i18n";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * Catches render/runtime errors anywhere in the React tree and shows a
 * recoverable screen instead of a blank white page. Styles are inline so this
 * screen renders even if the stylesheet failed to load.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "An unexpected error occurred.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept for local debugging; a crash-reporting SDK can be wired in here later.
    console.error("Buzz Buzz crashed:", error, info.componentStack);
  }

  private handleReload = () => {
    // A full reload re-hydrates the offline stores from local storage.
    window.location.assign("/");
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "24px",
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#0f172a",
          color: "#f8fafc",
        }}
      >
        <div style={{ fontSize: "44px" }}>🛠️</div>
        <h1 style={{ fontSize: "20px", margin: 0 }}>{translate("err_somethingWrong")}</h1>
        <p style={{ maxWidth: "320px", opacity: 0.8, margin: 0, lineHeight: 1.5 }}>
          The app hit an unexpected problem. Your saved data is safe. Tap below to reload.
        </p>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            marginTop: "8px",
            padding: "12px 28px",
            fontSize: "16px",
            fontWeight: 600,
            color: "#0f172a",
            background: "#22d3ee",
            border: "none",
            borderRadius: "12px",
            cursor: "pointer",
          }}
        >
          Reload app
        </button>
        {this.state.message ? (
          <p style={{ fontSize: "12px", opacity: 0.5, marginTop: "4px", wordBreak: "break-word" }}>
            {this.state.message}
          </p>
        ) : null}
      </div>
    );
  }
}
