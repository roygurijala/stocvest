import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDTStatusWidget } from "@/components/pdt-status-widget";
import { OptionsChainPanel } from "@/components/options-chain-panel";
import { FuturesDashboardPanel } from "@/components/futures-dashboard-panel";
import { PortfolioMultiBrokerPanel } from "@/components/portfolio-multi-broker-panel";
import { BrokerConnectivityPanel } from "@/components/broker-connectivity-panel";

describe("dashboard UI rendering obligations", () => {
  test("pdt widget renders warning and blocked states clearly", () => {
    const warningHtml = renderToStaticMarkup(
      createElement(PDTStatusWidget, {
        status: {
          user_id: "u1",
          assessment: {
            pdt_exempt: false,
            day_trades_in_window: 2,
            current_day_trade_count: 2,
            max_non_exempt: 3,
            rolling_business_days: 5,
            allow_next_day_trade: true,
            warn_near_limit: true,
            at_limit: false,
            days_until_reset: 1
          }
        }
      })
    );
    expect(warningHtml).toContain("Status:");
    expect(warningHtml).toContain("WARNING");
    expect(warningHtml).toContain("2 day trades used");

    const blockedHtml = renderToStaticMarkup(
      createElement(PDTStatusWidget, {
        status: {
          user_id: "u1",
          assessment: {
            pdt_exempt: false,
            day_trades_in_window: 3,
            current_day_trade_count: 3,
            max_non_exempt: 3,
            rolling_business_days: 5,
            allow_next_day_trade: false,
            warn_near_limit: false,
            at_limit: true,
            days_until_reset: 1
          }
        }
      })
    );
    expect(blockedHtml).toContain("BLOCKED");
    expect(blockedHtml).toContain("blocked until reset");
  });

  test("options panel always renders delayed-data banner", () => {
    const html = renderToStaticMarkup(
      createElement(OptionsChainPanel, {
        overview: {
          symbol: "AAPL",
          delayedByMinutes: 15,
          rows: []
        }
      })
    );
    expect(html).toContain("Data Delay Notice");
    expect(html).toContain("15 minutes");
    expect(html).toContain("Polygon Options Starter");
  });

  test("futures panel renders disconnected guidance when TWS unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(FuturesDashboardPanel, {
        overview: {
          connected: false,
          statusMessage: "IBKR TWS unavailable: disconnected",
          accounts: [],
          positionsByAccount: {}
        }
      })
    );
    expect(html).toContain("IBKR TWS unavailable");
    expect(html).toContain("Connect TWS/IB Gateway");
  });

  test("portfolio panel renders partial data with per-account errors", () => {
    const html = renderToStaticMarkup(
      createElement(PortfolioMultiBrokerPanel, {
        overview: {
          accounts: [
            {
              broker: "mock",
              accountId: "A1",
              summary: {
                broker: "mock",
                account_id: "A1",
                positions_count: 1,
                priced_positions_count: 1,
                total_market_value: 100,
                total_cost_basis: 100,
                gross_exposure: 100,
                net_exposure: 100,
                unrealized_pnl: 0
              }
            },
            {
              broker: "ibkr",
              accountId: "unavailable",
              error: "gateway unavailable"
            }
          ]
        }
      })
    );
    expect(html).toContain("MOCK");
    expect(html).toContain("Gross:");
    expect(html).toContain("gateway unavailable");
  });

  test("broker connectivity panel renders disconnected broker error cards", () => {
    const html = renderToStaticMarkup(
      createElement(BrokerConnectivityPanel, {
        overviews: [
          {
            broker: "etrade",
            positionsByAccount: {},
            error: "sandbox login failed"
          }
        ]
      })
    );
    expect(html).toContain("etrade");
    expect(html).toContain("Unavailable");
    expect(html).toContain("sandbox login failed");
  });
});
