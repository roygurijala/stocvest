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
  market_status?: string | null;
};

/** FRED ``VIXCLS`` daily close — day-over-day % only, not intraday session. */
export function vixSnapshotIsFredDaily(s: MarketSnapshotVixFields | null | undefined): boolean {
  return String(s?.market_status || "").trim() === "fred_daily";
}

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

/** True when a snapshot row has a computable session change (indexes + VIX). */
export function snapshotHasUsableQuote(s: MarketSnapshotVixFields | null | undefined): boolean {
  return vixSnapshotSessionChangePct(s) != null;
}

/** True when the hero strip can show a usable VIX level or session %. */
export function vixPulseDataAvailable(
  snapshot: MarketSnapshotVixFields | undefined,
  sessionPct: number | null
): boolean {
  if (sessionPct != null && Number.isFinite(sessionPct)) return true;
  return vixSnapshotDisplayLevel(snapshot) != null;
}

/** Pick the first VIX row the dashboard can render from a snapshot list. */
export function pickUsableVixSnapshot(
  snapshots: readonly MarketSnapshotVixFields[]
): MarketSnapshotVixFields | null {
  const preferred = new Set(["I:VIX", "^VIX", "VIX"]);
  const bySym = new Map<string, MarketSnapshotVixFields>();
  const fringe: MarketSnapshotVixFields[] = [];
  for (const x of snapshots) {
    const row = x as MarketSnapshotVixFields & { symbol?: string };
    const u = String(row.symbol || "")
      .trim()
      .toUpperCase();
    if (!u) continue;
    bySym.set(u, row);
    if (!preferred.has(u) && isVixTickerSymbol(u)) fringe.push(row);
  }
  const pickUsable = (hit: MarketSnapshotVixFields | undefined): MarketSnapshotVixFields | null => {
    if (!hit) return null;
    const pct = vixSnapshotSessionChangePct(hit);
    return vixPulseDataAvailable(hit, pct) ? hit : null;
  };
  for (const k of ["I:VIX", "^VIX", "VIX"]) {
    const ok = pickUsable(bySym.get(k));
    if (ok) return ok;
  }
  for (const x of fringe) {
    const ok = pickUsable(x);
    if (ok) return ok;
  }
  return null;
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
