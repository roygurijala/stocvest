/**
 * Fallback while deferred scanner RSC resolves (ribbon + desks region).
 * Static surface colors so this can render from server or client without theme.
 */
export function DashboardScannerSuspenseFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading scanner and desk data"
      className="rounded-lg border border-slate-700/60 bg-slate-900/40"
      style={{
        minHeight: 280,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        padding: "1.25rem"
      }}
    >
      <span
        className="stocvest-pulse-dot"
        style={{ width: 10, height: 10, borderRadius: 999, background: "rgba(148,163,184,0.55)" }}
      />
      <p style={{ margin: 0, fontSize: 13, color: "rgba(148,163,184,0.95)", fontWeight: 500 }}>
        Loading setups & gap context…
      </p>
    </div>
  );
}
