import type { BrokerKind, BrokerOverview } from "@/lib/api/brokers";

export interface PortfolioSummaryPayload {
  broker: BrokerKind;
  account_id: string;
  positions_count: number;
  priced_positions_count: number;
  total_market_value: number;
  total_cost_basis: number;
  gross_exposure: number;
  net_exposure: number;
  unrealized_pnl: number;
}

export interface PortfolioAccountCard {
  broker: BrokerKind;
  accountId: string;
  summary?: PortfolioSummaryPayload;
  error?: string;
}

export interface PortfolioMultiBrokerOverview {
  accounts: PortfolioAccountCard[];
}

function summarizeFromPositions(
  broker: BrokerKind,
  accountId: string,
  positions: { quantity: number; avg_cost?: number | null }[]
): PortfolioSummaryPayload {
  let gross = 0;
  let net = 0;
  let totalMarketValue = 0;
  let totalCostBasis = 0;
  let pricedCount = 0;
  for (const position of positions) {
    const qty = Number(position.quantity || 0);
    const price = Number(position.avg_cost || 0);
    const marketValue = qty * price;
    gross += Math.abs(marketValue);
    net += marketValue;
    totalMarketValue += marketValue;
    totalCostBasis += marketValue;
    if (position.avg_cost != null) {
      pricedCount += 1;
    }
  }
  return {
    broker,
    account_id: accountId,
    positions_count: positions.length,
    priced_positions_count: pricedCount,
    total_market_value: Number(totalMarketValue.toFixed(4)),
    total_cost_basis: Number(totalCostBasis.toFixed(4)),
    gross_exposure: Number(gross.toFixed(4)),
    net_exposure: Number(net.toFixed(4)),
    unrealized_pnl: 0,
  };
}

export async function fetchPortfolioOverview(
  brokerOverviews: BrokerOverview[]
): Promise<PortfolioMultiBrokerOverview> {
  const cards: PortfolioAccountCard[] = [];
  for (const overview of brokerOverviews) {
    if (overview.error && (!overview.accounts || overview.accounts.length === 0)) {
      cards.push({
        broker: overview.broker,
        accountId: "unavailable",
        error: overview.error,
      });
      continue;
    }
    for (const account of overview.accounts || []) {
      const positions = overview.positionsByAccount[account.account_id] || [];
      cards.push({
        broker: overview.broker,
        accountId: account.account_id,
        summary: summarizeFromPositions(overview.broker, account.account_id, positions),
      });
    }
  }
  return { accounts: cards };
}
