/**
 * Fallback while deferred earnings RSC resolves (calendar strip at page foot).
 */
export function DashboardEarningsSuspenseFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading earnings calendar"
      className="rounded-lg border border-slate-700/60 bg-slate-900/40"
      style={{
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        padding: "1rem"
      }}
    >
      <span
        className="stocvest-pulse-dot"
        style={{ width: 8, height: 8, borderRadius: 999, background: "rgba(148,163,184,0.55)" }}
      />
      <p style={{ margin: 0, fontSize: 12, color: "rgba(148,163,184,0.95)", fontWeight: 500 }}>
        Loading earnings calendar…
      </p>
    </div>
  );
}
