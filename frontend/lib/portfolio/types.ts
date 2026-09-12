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
