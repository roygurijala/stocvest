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
export function buildSwingCompositeRequestBody(opts: {
  symbol: string;
  regime: string;
  rows: LayerRowLike[];
  snapshot: SnapshotPayload | null;
  pattern?: string;
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
  return {
    regime: opts.regime,
    symbol: opts.symbol.trim().toUpperCase(),
    signals,
    pattern: opts.pattern ?? "swing_composite"
  };
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
