/** Per-symbol desk tracking prefs — persisted on the default watchlist (server). */

export type WatchlistDeskTracking = {
  swing: boolean;
  day: boolean;
};

export function defaultDeskTracking(dualDesk: boolean): WatchlistDeskTracking {
  return dualDesk ? { swing: true, day: true } : { swing: true, day: false };
}

export function coerceDeskTracking(raw: unknown, dualDesk: boolean): WatchlistDeskTracking {
  if (!raw || typeof raw !== "object") return defaultDeskTracking(dualDesk);
  const o = raw as { swing?: unknown; day?: unknown; track_swing?: unknown; track_day?: unknown };
  const swing = Boolean(o.swing ?? o.track_swing ?? true);
  const day = Boolean(o.day ?? o.track_day ?? dualDesk);
  if (!dualDesk) return { swing, day: false };
  return { swing, day };
}

export async function fetchSymbolDeskTracking(
  symbol: string,
  dualDesk: boolean
): Promise<WatchlistDeskTracking> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return defaultDeskTracking(dualDesk);
  try {
    const res = await fetch("/api/stocvest/watchlists/default/symbols", {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!res.ok) return defaultDeskTracking(dualDesk);
    const data = (await res.json().catch(() => ({}))) as {
      symbol_tracking?: Record<string, unknown>;
    };
    const row = data.symbol_tracking?.[sym];
    return coerceDeskTracking(row, dualDesk);
  } catch {
    return defaultDeskTracking(dualDesk);
  }
}

export async function saveSymbolDeskTracking(
  watchlistId: string,
  symbol: string,
  tracking: WatchlistDeskTracking,
  dualDesk: boolean
): Promise<{ ok: boolean; message?: string }> {
  const sym = symbol.trim().toUpperCase();
  if (!sym || !watchlistId) return { ok: false, message: "Missing watchlist or symbol." };
  const body = dualDesk
    ? { track_swing: tracking.swing, track_day: tracking.day }
    : { track_swing: tracking.swing, track_day: false };
  try {
    const res = await fetch(
      `/api/stocvest/watchlists/${encodeURIComponent(watchlistId)}/symbols/${encodeURIComponent(sym)}/tracking`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }
    );
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) return { ok: false, message: data.message || "Could not save tracking." };
    return { ok: true };
  } catch {
    return { ok: false, message: "Network error." };
  }
}
