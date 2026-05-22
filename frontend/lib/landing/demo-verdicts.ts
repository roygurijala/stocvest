export type LandingDemoVerdict = {
  symbol: string;
  bias: "Bullish" | "Bearish" | "Neutral";
  alignmentLabel: string;
  alignedLayers: number;
  totalLayers: number;
  execution: string;
  actionable: boolean;
  whyNot: string[];
  /** One-line hook shown on the card */
  headline: string;
  /** Curated full example vs generic limited preview */
  limitedPreview: boolean;
};

export const LANDING_FULL_EXAMPLE_SYMBOLS = ["NFLX", "AAPL", "NVDA"] as const;

/** Curated previews — illustrative verdicts that show restraint vs signal-chasing. */
export const LANDING_DEMO_VERDICTS: Record<string, LandingDemoVerdict> = {
  NFLX: {
    symbol: "NFLX",
    bias: "Bearish",
    alignmentLabel: "Strong",
    alignedLayers: 5,
    totalLayers: 6,
    execution: "Not actionable",
    actionable: false,
    headline: "Aligned bearish — but not worth forcing yet.",
    limitedPreview: false,
    whyNot: [
      "Risk/reward below system threshold (about 1.4:1 vs 2.0 required)",
      "Waiting for a cleaner entry or confirmation on structure",
      "Most platforms would flag a short signal — we say wait"
    ]
  },
  AAPL: {
    symbol: "AAPL",
    bias: "Bullish",
    alignmentLabel: "Moderate",
    alignedLayers: 4,
    totalLayers: 6,
    execution: "Not actionable",
    actionable: false,
    headline: "Direction looks fine — execution does not.",
    limitedPreview: false,
    whyNot: [
      "Layers disagree on timing (macro vs sector)",
      "Reward does not clear the minimum R/R gate for swing desk",
      "Better to watch for alignment to strengthen than enter early"
    ]
  },
  NVDA: {
    symbol: "NVDA",
    bias: "Bullish",
    alignmentLabel: "Strong",
    alignedLayers: 6,
    totalLayers: 6,
    execution: "Actionable (swing desk)",
    actionable: true,
    headline: "When layers agree — we surface it with levels.",
    limitedPreview: false,
    whyNot: [
      "This is what actionable looks like: structure, catalyst, and R/R aligned",
      "Entry zone, stop, and target published inside the product",
      "Signup unlocks live updates and full evidence cards"
    ]
  },
  TSLA: {
    symbol: "TSLA",
    bias: "Neutral",
    alignmentLabel: "Mixed",
    alignedLayers: 3,
    totalLayers: 6,
    execution: "Not actionable",
    actionable: false,
    headline: "No edge — discipline is to stay out.",
    limitedPreview: false,
    whyNot: [
      "Conflicting layer scores (news vs technical)",
      "Volatility regime does not support a clean swing plan",
      "Skipping is the correct decision, not missing a trade"
    ]
  },
  MSFT: {
    symbol: "MSFT",
    bias: "Bullish",
    alignmentLabel: "Strong",
    alignedLayers: 5,
    totalLayers: 6,
    execution: "Monitor only",
    actionable: false,
    headline: "Strong alignment — session gates closed.",
    limitedPreview: false,
    whyNot: [
      "Desk posture suppressed until structure confirms",
      "Near qualification — on watchlist maturation, not a chase",
      "STOCVEST favors patience over activity"
    ]
  }
};

export function normalizeLandingTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z.]/g, "");
}

export function resolveLandingDemoVerdict(symbol: string): LandingDemoVerdict | null {
  const key = normalizeLandingTicker(symbol);
  if (!key || key.length > 8) return null;
  return LANDING_DEMO_VERDICTS[key] ?? null;
}

export function genericLandingDemoVerdict(symbol: string): LandingDemoVerdict {
  const key = normalizeLandingTicker(symbol) || "TICKER";
  return {
    symbol: key,
    bias: "Neutral",
    alignmentLabel: "Preview",
    alignedLayers: 0,
    totalLayers: 6,
    execution: "Sign up for live verdict",
    actionable: false,
    headline: "See the full six-layer read inside STOCVEST.",
    limitedPreview: true,
    whyNot: [
      `Live ${key} verdicts update with market data after free signup`,
      "Try NFLX, AAPL, or NVDA for full example previews on this page"
    ]
  };
}

export function isLandingFullExampleSymbol(symbol: string): boolean {
  const key = normalizeLandingTicker(symbol);
  return (LANDING_FULL_EXAMPLE_SYMBOLS as readonly string[]).includes(key);
}
