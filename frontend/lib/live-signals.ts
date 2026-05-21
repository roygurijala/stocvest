"use client";

/** US equity regular session (ET), best-effort — matches Edge /api/signals/live gate. */
export function isMarketHours(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (wd === "Sat" || wd === "Sun") return false;
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutes = h * 60 + m;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/**
 * Live hint hook — intentionally does NOT open `EventSource` to `/api/signals/live`.
 *
 * Long-lived SSE on Edge was closing after ~30–60s (`Connection closed` in the
 * Next.js client bundle). Dashboard freshness is covered by `useDashboardPayload`
 * (`refreshInterval: 60_000`) in `DashboardEdgeSync`; that path is sufficient.
 */
export function useLiveSignals(
  _mode: "swing" | "day",
  _onRefreshNeeded: (expectedVersion: string) => void
) {
  /* no-op — polling-only */
}
