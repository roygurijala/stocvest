import type { SnapshotPayload } from "@/lib/api/market";

export const SWING_COMPOSITE_LAYER_KEYS = [
  "technical",
  "news",
  "macro",
  "sector",
  "geopolitical",
  "internals"
] as const;

export type SwingCompositeMarketStatus = {
  is_market_open: boolean;
  next_open: string | null;
  market_session: string;
};

export type LayerRowLike = {
  status: string;
  score: number;
};

/**
 * Build POST /v1/signals/swing/composite body from dashboard layer rows.
 * Omits price_at_signal so passive UI checks do not persist SignalRecords.
 */
function snapshotForCompositeBody(snapshot: SnapshotPayload | null): Record<string, number> | undefined {
  if (!snapshot) return undefined;
  const out: Record<string, number> = {};
  const add = (key: keyof SnapshotPayload, dest: string) => {
    const v = snapshot[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[dest] = v;
    }
  };
  add("last_trade_price", "last_trade_price");
  add("day_low", "day_low");
  add("day_high", "day_high");
  add("day_vwap", "day_vwap");
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildSwingCompositeRequestBody(opts: {
  symbol: string;
  regime: string;
  rows: LayerRowLike[];
  snapshot: SnapshotPayload | null;
  pattern?: string;
  /** Optional headline for swing-composite catalyst enrichment (not investment advice). */
  newsCatalyst?: { headline: string; sentiment: "positive" | "negative" | "neutral" } | null;
}): Record<string, unknown> {
  const signals = SWING_COMPOSITE_LAYER_KEYS.map((layer, idx) => {
    const row = opts.rows[idx];
    const unavailable = !opts.snapshot || row == null || row.status === "Unavailable";
    if (unavailable) {
      return { layer, status: "unavailable", score: null, confidence: 0 };
    }
    const score01 = row.score / 100;
    const directional = Math.max(-1, Math.min(1, score01 * 2 - 1));
    return { layer, score: directional, confidence: 0.82 };
  });
  const snap = snapshotForCompositeBody(opts.snapshot);
  const body: Record<string, unknown> = {
    regime: opts.regime,
    symbol: opts.symbol.trim().toUpperCase(),
    signals,
    pattern: opts.pattern ?? "swing_composite"
  };
  if (snap) {
    body.symbol_snapshot = snap;
  }
  const nc = opts.newsCatalyst;
  if (nc && nc.headline.trim()) {
    body.news_catalyst = { headline: nc.headline.trim().slice(0, 500), sentiment: nc.sentiment };
  }
  return body;
}

export function isInsufficientCompositeResponse(
  body: Record<string, unknown> | null
): body is {
  status: "insufficient_data";
  market_status: SwingCompositeMarketStatus;
  message: string;
  symbol: string;
  available_layers: number;
  required_layers: number;
  disclaimer: string;
} {
  return (
    body != null &&
    body.status === "insufficient_data" &&
    typeof body.market_status === "object" &&
    body.market_status != null
  );
}
