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

function numish(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function positiveNumish(v: unknown): number | null {
  const n = numish(v);
  return n != null && n > 0 ? n : null;
}

/** Read a field with loose JSON typing (some paths stringify numbers). */
function field(obj: MarketSnapshotVixFields, key: keyof MarketSnapshotVixFields): unknown {
  return (obj as Record<string, unknown>)[key as string];
}

/** Level for VIX pulse / regime: last trade when present, else session close (Polygon omits last on some index ticks). */
export function vixSnapshotDisplayLevel(s: MarketSnapshotVixFields | null | undefined): number | null {
  if (!s) return null;
  const lp = positiveNumish(field(s, "last_trade_price"));
  if (lp != null) return lp;
  return positiveNumish(field(s, "day_close"));
}

function pctFieldClean(v: unknown): number | null {
  const n = numish(v);
  if (n == null) return null;
  if (n <= -99.5) return null;
  return n;
}

/**
 * Session change % for VIX-style snapshots: prefers Polygon fields, then derives from
 * display level (last or day close) vs prior close.
 */
export function vixSnapshotSessionChangePct(s: MarketSnapshotVixFields | null | undefined): number | null {
  if (!s) return null;
  const c = pctFieldClean(field(s, "change_percent"));
  if (c != null) return c;
  const pre = pctFieldClean(field(s, "pre_market_change_percent"));
  if (pre != null) return pre;
  const ah = pctFieldClean(field(s, "after_hours_change_percent"));
  if (ah != null) return ah;
  const level = vixSnapshotDisplayLevel(s);
  const prev = numish(field(s, "prev_close"));
  if (level != null && prev != null && prev !== 0) {
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

/** Polygon / vendors may label VIX under alternate tickers — use for discovery, not display. */
export function isVixTickerSymbol(raw: string | undefined | null): boolean {
  const u = String(raw || "")
    .trim()
    .toUpperCase();
  if (!u) return false;
  if (u === "I:VIX" || u === "^VIX" || u === "VIX") return true;
  if (u.endsWith(":VIX")) return true;
  return false;
}
