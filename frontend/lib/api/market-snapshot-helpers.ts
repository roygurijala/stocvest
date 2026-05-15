/**
 * Pure snapshot math for dashboard UI (client-safe).
 *
 * No imports from `@/lib/api/market` or `@/lib/api/client` — avoids pulling
 * `next/headers` into Client Component bundles.
 */

/** Fields read from `SnapshotPayload` for VIX pulse logic (structural subset). */
export type MarketSnapshotVixFields = {
  last_trade_price?: number | null;
  day_close?: number | null;
  prev_close?: number | null;
  change_percent?: number | null;
  pre_market_change_percent?: number | null;
  after_hours_change_percent?: number | null;
};

/** Level for VIX pulse / regime: last trade when present, else session close (Polygon omits last on some index ticks). */
export function vixSnapshotDisplayLevel(s: MarketSnapshotVixFields | null | undefined): number | null {
  if (!s) return null;
  const lp = s.last_trade_price;
  if (typeof lp === "number" && Number.isFinite(lp) && lp > 0) return lp;
  const dc = s.day_close;
  if (typeof dc === "number" && Number.isFinite(dc) && dc > 0) return dc;
  return null;
}

function pctFieldClean(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v <= -99.5) return null;
  return v;
}

/**
 * Session change % for VIX-style snapshots: prefers Polygon fields, then derives from
 * display level (last or day close) vs prior close.
 */
export function vixSnapshotSessionChangePct(s: MarketSnapshotVixFields | null | undefined): number | null {
  if (!s) return null;
  const c = pctFieldClean(s.change_percent);
  if (c != null) return c;
  const pre = pctFieldClean(s.pre_market_change_percent);
  if (pre != null) return pre;
  const ah = pctFieldClean(s.after_hours_change_percent);
  if (ah != null) return ah;
  const level = vixSnapshotDisplayLevel(s);
  const prev = s.prev_close;
  if (
    level != null &&
    typeof prev === "number" &&
    Number.isFinite(prev) &&
    prev !== 0
  ) {
    return pctFieldClean(((level - prev) / prev) * 100);
  }
  return null;
}

/** True when the hero strip can show a usable VIX level or session %. */
export function vixPulseDataAvailable(
  snapshot: MarketSnapshotVixFields | undefined,
  sessionPct: number | null
): boolean {
  if (sessionPct != null && Number.isFinite(sessionPct)) return true;
  return vixSnapshotDisplayLevel(snapshot) != null;
}
