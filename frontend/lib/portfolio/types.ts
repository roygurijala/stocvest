/**
 * Manual portfolio (holdings) types — mirror of the backend `/v1/holdings` shapes
 * (`stocvest/models/portfolio_holding.py`). Advisory-only personal portfolio; NOT a
 * broker link (distinct from the paused broker portfolio surface).
 */

export interface HoldingLot {
  lotId: string;
  quantity: number;
  costBasis: number; // price paid per share
  purchaseDate: string; // ISO YYYY-MM-DD
  note?: string | null;
}

export interface Holding {
  symbol: string;
  totalQuantity: number;
  averageCost: number | null;
  totalCost: number;
  lots: HoldingLot[];
}

/** What the client sends on upsert — the server derives totals. */
export interface HoldingInput {
  symbol: string;
  lots: HoldingLot[];
}

export interface PortfolioSettings {
  cashBalance: number;
  targetPositionPct: number | null;
  benchmarkSymbol: string;
}

export const DEFAULT_PORTFOLIO_SETTINGS: PortfolioSettings = {
  cashBalance: 0,
  targetPositionPct: null,
  benchmarkSymbol: "SPY"
};

export type PortfolioLedgerKind = "sale" | "buy" | "review";
export type PortfolioAdviceOutcome = "favorable" | "unfavorable" | "neutral" | "pending";
export type PortfolioFollowThrough = "followed" | "ignored" | "diverged" | "n/a";

export interface PortfolioLedgerEvent {
  eventId: string;
  kind: PortfolioLedgerKind;
  symbol: string;
  occurredAt: string;
  quantity: number | null;
  pricePerShare: number | null;
  costBasisPerShare: number | null;
  realizedPl: number | null;
  realizedPlPct: number | null;
  remainingQuantity: number | null;
  cashCredited: number | null;
  adviceAction: string | null;
  adviceGeneratedAt: string | null;
  adviceVerdict: string | null;
  adviceSuggestedAddAmount: number | null;
  adviceSuggestedReduceAmount: number | null;
  adviceSizingReason: string | null;
  adviceSleeve: string | null;
  priceAtAdvice: number | null;
  weightPct: number | null;
  adviceAttributionStatus: string | null;
  priceAfter30d: number | null;
  priceAfter90d: number | null;
  outcome30d: string | null;
  outcome90d: string | null;
}

export interface PortfolioLedgerSummary {
  salesCount: number;
  realizedPl: number;
  outcome30d: Record<string, number>;
  outcome90d: Record<string, number>;
  followThrough: { followed: number; ignored: number; diverged: number };
}

export interface PortfolioLedgerResponse {
  events: PortfolioLedgerEvent[];
  count: number;
  summary: PortfolioLedgerSummary;
}
