/** User-facing copy for info icons (no proprietary weights). */

export const MARKET_SENTIMENT_SCORE_TIP =
  "Score from 0-100 combining six signal layers. Above 55 is bullish, below 45 is bearish. How layers are blended is proprietary.";

export const GAP_CANDIDATES_TIP =
  "A gap occurs when a stock opens significantly higher or lower than yesterday's close, often driven by overnight news or earnings.";

export const PDT_GUARDIAN_TIP =
  "Pattern Day Trader (PDT): FINRA limits how many day trades you can make in five business days when your account is under $25k (unless exempt). The limit exists to reduce outsized risk for smaller accounts.";

export const CONFIDENCE_PERCENT_TIP =
  "Confidence is the model's 0-100 strength score for this intraday setup based on automated factors (not investment advice).";

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
