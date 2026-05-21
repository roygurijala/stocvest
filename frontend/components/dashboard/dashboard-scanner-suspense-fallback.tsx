/**
 * Inline status while deferred scanner RSC resolves (Tier 1.C).
 * Shown at the top of the dashboard grid — not a full-page blocker.
 */
export function DashboardScannerLoadingStrip() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Refreshing scanner and desk data"
      data-testid="dashboard-scanner-loading"
      className="flex items-center gap-2 rounded-md border border-slate-700/50 bg-slate-900/30 px-3 py-2"
    >
      <span
        className="stocvest-pulse-dot shrink-0"
        style={{ width: 8, height: 8, borderRadius: 999, background: "rgba(148,163,184,0.55)" }}
      />
      <p style={{ margin: 0, fontSize: 12, color: "rgba(148,163,184,0.95)", fontWeight: 500 }}>
        Refreshing scanner…
      </p>
    </div>
  );
}

/** @deprecated Use {@link DashboardScannerLoadingStrip} — kept for imports that expect a Suspense fallback name. */
export const DashboardScannerSuspenseFallback = DashboardScannerLoadingStrip;
