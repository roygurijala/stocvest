import type { SnapshotPayload } from "@/lib/api/market";
import {
  buildWatchlistCardModel,
  resolveWatchlistAttentionTier,
  sortSymbolsInAttentionTier,
  type WatchlistAttentionTier,
  type WatchlistCardModel
} from "@/lib/watchlist-decision-card-present";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

const RADAR_MAX = 6;
const MOVE_PCT_THRESHOLD = 4.0;

export type WatchlistRadarRow = WatchlistCardModel & {
  attentionReason: string;
};

function sessionMovePct(snapshot: SnapshotPayload | undefined): number | null {
  if (!snapshot) return null;
  const c = snapshot.change_percent;
  if (typeof c === "number" && Number.isFinite(c) && c > -99) return c;
  const last = snapshot.last_trade_price;
  const prev = snapshot.prev_close;
  if (
    typeof last === "number" &&
    typeof prev === "number" &&
    Number.isFinite(last) &&
    Number.isFinite(prev) &&
    prev !== 0
  ) {
    return ((last - prev) / prev) * 100;
  }
  return null;
}

function attentionReasonFor(
  tier: WatchlistAttentionTier,
  row: WatchlistMaturationRow | undefined,
  movePct: number | null
): string | null {
  if (tier === "check_now") {
    if (row?.progress_band === "near_ready" || row?.progress_band === "actionable") {
      return "Near actionable on your list";
    }
    return "Worth opening on Signals";
  }
  if (tier === "getting_close") return "Building on your watchlist";
  if (movePct != null && Math.abs(movePct) >= MOVE_PCT_THRESHOLD) {
    return `${movePct >= 0 ? "+" : ""}${movePct.toFixed(1)}% session move`;
  }
  return null;
}

export function buildWatchlistRadarRows(opts: {
  symbols: string[];
  rowForSymbol: (sym: string) => WatchlistMaturationRow | undefined;
  snapshotForSymbol: (sym: string) => SnapshotPayload | undefined;
  colors: { accent: string; bullish: string; bearish: string; caution: string; textMuted: string };
  mode: "swing" | "day";
}): WatchlistRadarRow[] {
  const buckets: Record<WatchlistAttentionTier, string[]> = {
    check_now: [],
    getting_close: [],
    tracking: []
  };
  for (const sym of opts.symbols) {
    const symU = sym.trim().toUpperCase();
    if (!symU) continue;
    const tier = resolveWatchlistAttentionTier(opts.rowForSymbol(symU));
    buckets[tier].push(symU);
  }

  const ordered = [
    ...sortSymbolsInAttentionTier(buckets.check_now, opts.rowForSymbol),
    ...sortSymbolsInAttentionTier(buckets.getting_close, opts.rowForSymbol)
  ];

  const seen = new Set<string>();
  const out: WatchlistRadarRow[] = [];

  for (const sym of ordered) {
    if (seen.has(sym)) continue;
    const row = opts.rowForSymbol(sym);
    const snap = opts.snapshotForSymbol(sym);
    const tier = resolveWatchlistAttentionTier(row);
    const movePct = sessionMovePct(snap);
    let reason = attentionReasonFor(tier, row, movePct);
    if (!reason && movePct != null && Math.abs(movePct) >= MOVE_PCT_THRESHOLD) {
      reason = `${movePct >= 0 ? "+" : ""}${movePct.toFixed(1)}% today`;
    }
    if (!reason && tier === "tracking") continue;

    const model = buildWatchlistCardModel(sym, row, snap, opts.colors, opts.mode);
    out.push({
      ...model,
      attentionReason: reason ?? model.alignmentLine
    });
    seen.add(sym);
    if (out.length >= RADAR_MAX) break;
  }

  return out;
}
