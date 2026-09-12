/**
 * Pure presenter for the manual portfolio page — cost basis, live market value,
 * unrealized P/L, and portfolio weights. No React, no fetch, no clock.
 *
 * Deliberately decoupled from the snapshot payload shape: the caller passes a
 * `priceOf(symbol)` resolver so this stays trivially unit-testable. When a symbol
 * has no live price we fall back to its average cost for market value (so totals
 * and weights stay coherent) but report `unrealizedPl = null` and `priced = false`
 * so the UI can show "—" rather than a fake $0 gain.
 */
import type { Holding, PortfolioSettings } from "@/lib/portfolio/types";

export interface HoldingView {
  symbol: string;
  quantity: number;
  averageCost: number | null;
  totalCost: number;
  currentPrice: number | null;
  priced: boolean;
  marketValue: number | null;
  unrealizedPl: number | null;
  unrealizedPlPct: number | null;
  /** Share of total portfolio value (holdings market value + cash). */
  weightPct: number | null;
  lotCount: number;
}

export interface PortfolioView {
  rows: HoldingView[];
  holdingsCount: number;
  investedCost: number;
  investedValue: number;
  cashBalance: number;
  totalValue: number;
  unrealizedPl: number;
  unrealizedPlPct: number | null;
  /** True when every holding had a live price (P/L totals are fully live). */
  fullyPriced: boolean;
  targetPositionPct: number | null;
  benchmarkSymbol: string;
}

export type PriceResolver = (symbol: string) => number | null | undefined;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function buildRow(holding: Holding, priceOf: PriceResolver): HoldingView {
  const quantity = holding.totalQuantity;
  const totalCost = holding.totalCost;
  const averageCost = holding.averageCost;

  const rawPrice = priceOf(holding.symbol);
  const currentPrice =
    typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
  const priced = currentPrice != null;

  // Fall back to average cost so an unpriced holding still contributes at cost.
  const effectivePrice = currentPrice ?? averageCost ?? 0;
  const marketValue = round2(effectivePrice * quantity);

  const unrealizedPl = priced ? round2(marketValue - totalCost) : null;
  const unrealizedPlPct =
    priced && totalCost > 0 ? round2(((marketValue - totalCost) / totalCost) * 100) : null;

  return {
    symbol: holding.symbol,
    quantity,
    averageCost,
    totalCost,
    currentPrice,
    priced,
    marketValue,
    unrealizedPl,
    unrealizedPlPct,
    weightPct: null, // filled in after we know the portfolio total
    lotCount: holding.lots.length
  };
}

export function buildPortfolioView(
  holdings: readonly Holding[],
  settings: PortfolioSettings,
  priceOf: PriceResolver
): PortfolioView {
  const rows = holdings.map((h) => buildRow(h, priceOf));

  const investedValue = round2(rows.reduce((sum, r) => sum + (r.marketValue ?? 0), 0));
  const investedCost = round2(rows.reduce((sum, r) => sum + r.totalCost, 0));
  const cashBalance = round2(settings.cashBalance || 0);
  const totalValue = round2(investedValue + cashBalance);

  for (const r of rows) {
    r.weightPct =
      totalValue > 0 && r.marketValue != null ? round2((r.marketValue / totalValue) * 100) : null;
  }

  const unrealizedPl = round2(investedValue - investedCost);
  const unrealizedPlPct = investedCost > 0 ? round2((unrealizedPl / investedCost) * 100) : null;
  const fullyPriced = rows.length > 0 && rows.every((r) => r.priced);

  return {
    rows,
    holdingsCount: rows.length,
    investedCost,
    investedValue,
    cashBalance,
    totalValue,
    unrealizedPl,
    unrealizedPlPct,
    fullyPriced,
    targetPositionPct: settings.targetPositionPct,
    benchmarkSymbol: settings.benchmarkSymbol || "SPY"
  };
}

/**
 * Suggested dollar amount to reach the target weight for a position (or to open a
 * new one). Returns null when no target is set. Never suggests more than available
 * cash. Positive = room to add; <= 0 means already at/over target (no buy).
 */
export function suggestedAddAmount(
  currentMarketValue: number,
  totalValue: number,
  targetPositionPct: number | null,
  cashAvailable: number
): number | null {
  if (targetPositionPct == null || totalValue <= 0) return null;
  const targetValue = (targetPositionPct / 100) * totalValue;
  const gap = targetValue - currentMarketValue;
  if (gap <= 0) return 0;
  return round2(Math.min(gap, Math.max(0, cashAvailable)));
}
