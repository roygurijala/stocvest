/** User-facing copy for info icons (no proprietary weights). */

export const MARKET_SENTIMENT_SCORE_TIP =
  "A score from 0-100 combining six signal layers. Above 55 is bullish, below 45 is bearish. Calculated from technical indicators, news sentiment, macro conditions, sector rotation, geopolitical risk, and market internals.";

export const GAP_CANDIDATES_TIP =
  "A gap occurs when a stock opens significantly higher or lower than its previous close, often driven by overnight earnings, news, or analyst actions. Gap candidates show pre-market movers with unusual volume.";

export const PDT_GUARDIAN_TIP =
  "The Pattern Day Trader rule limits traders with accounts under $25,000 to 3 day trades within any 5 business days. STOCVEST enforces this automatically at the broker layer — not just a warning.";

export const CONFIDENCE_PERCENT_TIP =
  "Confidence reflects how strongly the six signal layers agree. 80%+ means strong alignment across layers. 50-65% means mixed signals with moderate conviction.";

export const SETUP_RELATIVE_VOLUME_TIP =
  "Colored fill vs grey baseline compares today's volume to a typical level for this scan batch (uses the same-symbol gap row when available, otherwise a model-based estimate). Higher participation can mean more conviction—it is not a guarantee.";

export const LAYER_NAME_HINTS: Record<string, string> = {
  technical: "Price action, momentum, and key intraday structure.",
  news: "Headline and catalyst context around the symbol.",
  macro: "Rates, FX, and scheduled macro backdrop.",
  sector: "Sector leadership versus the broad market.",
  geopolitical: "Geopolitical risk headlines affecting tape tone.",
  internals: "Breadth, volatility, and market participation."
};
