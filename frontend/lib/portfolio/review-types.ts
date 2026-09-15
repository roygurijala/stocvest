/**
 * Types for the daily portfolio review (`GET /v1/portfolio-review`).
 * Shapes mirror `stocvest/api/services/portfolio_review.py` `to_api()` (camelCase).
 */

export type ReviewAction = "buy_more" | "hold" | "trim" | "sell" | "review";

/** Review-level sleeve + stance-overlay one-liner. */
export const PORTFOLIO_REVIEW_SIZING_RULE =
  "Conviction sleeves: core 10–15%, standard 6–9%, vehicle 4–6%, exit 0–3%; single-name max 15%. Add only below the sleeve floor; trim only above the sleeve high. Sell still reduces the full position. Hold + caution does not add.";

export interface HoldingReview {
  symbol: string;
  quantity: number;
  averageCost: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  unrealizedPlPct: number | null;
  weightPct: number | null;
  verdict: string;
  confidence: number | null;
  action: ReviewAction;
  actionLabel: string;
  rationale: string[];
  overweight: boolean;
  suggestedAddAmount: number | null;
  suggestedReduceAmount: number | null;
  sizingReason?: string | null;
  effectiveTargetPct?: number | null;
  sleeve?: string | null;
  sleeveLowPct?: number | null;
  sleeveHighPct?: number | null;
  taxLotHint: string | null;
  longTermLots: number;
  shortTermLots: number;
  isFundVehicle?: boolean;
  holderRead: {
    stance?: string;
    headline?: string;
    actions?: string[];
    context?: string[];
    disclaimer?: string;
  } | null;
  aiRead: string | null;
}

export interface ConcentrationFlag {
  symbol: string;
  weightPct: number;
  targetPct: number | null;
  message: string;
}

export interface ConsiderAddCandidate {
  symbol: string;
  tier: string;
  verdict: string;
  why: string;
}

export interface BenchmarkComparison {
  benchmarkSymbol: string;
  investedCost: number;
  benchmarkValue: number | null;
  benchmarkReturnPct: number | null;
  note: string;
}

export interface PortfolioReview {
  generatedAt: string;
  cached?: boolean;
  cachedAt?: string | null;
  stale?: boolean;
  pending?: boolean;
  holdings: HoldingReview[];
  totalMarketValue: number;
  investedValue: number;
  cashBalance: number;
  totalCost: number;
  unrealizedPl: number | null;
  unrealizedPlPct: number | null;
  portfolioReturnPct: number | null;
  concentration: ConcentrationFlag[];
  considerAdding: ConsiderAddCandidate[];
  benchmark: BenchmarkComparison | null;
  fullyPriced: boolean;
  effectiveTargetPct?: number | null;
  targetIsDefault?: boolean;
  sizingPolicy?: "sleeve" | "explicit" | null;
  sizingRule?: string;
  disclaimer: string;
}
