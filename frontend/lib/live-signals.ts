"use client";

import { useCallback, useEffect, useRef } from "react";

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
 * SSE-style hint stream — payload is version-only; always re-fetch /api/dashboard.
 * 60s polling in dashboard-edge-sync covers missed hints.
 */
export function useLiveSignals(
  mode: "swing" | "day",
  onRefreshNeeded: (expectedVersion: string) => void
) {
  const onRefresh = useRef(onRefreshNeeded);
  onRefresh.current = onRefreshNeeded;

  useEffect(() => {
    if (mode !== "day") return;
    if (!isMarketHours()) return;

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      source = new EventSource(`/api/signals/live?mode=${encodeURIComponent(mode)}`);

      source.onmessage = (event: MessageEvent<string>) => {
        try {
          const hint = JSON.parse(event.data) as { type?: string; state_version?: string };
          if (hint.type === "signal_update" && hint.state_version) {
            onRefresh.current(hint.state_version);
          }
        } catch {
          /* ignore */
        }
      };

      source.onerror = () => {
        source?.close();
        reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [mode]);
}
