import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SignalsAfterHoursPanel } from "@/components/signals-after-hours-panel";
import { ThemeProvider } from "@/lib/theme-provider";

describe("SignalsAfterHoursPanel", () => {
  test("renders fallback sections when data is missing", () => {
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(SignalsAfterHoursPanel, {
          symbol: "AAPL",
          snapshot: null,
          marketStatus: { is_market_open: false, market_session: "closed", next_open: null },
          earningsEvent: null,
          newsArticles: [],
          isInDefaultWatchlist: false,
          watchlistCheckComplete: false
        })
      )
    );
    expect(html).toContain("After-Hours Research Panel");
    expect(html).toContain("Last Session Reference Levels");
    expect(html).toContain("No recent headlines available right now.");
    expect(html).toContain("Reference levels from last session data. Not predictions. Not investment advice.");
  });

  test("shows news and watchlist CTA behavior", () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        null,
        createElement(SignalsAfterHoursPanel, {
          symbol: "NVDA",
          snapshot: { symbol: "NVDA", last_trade_price: 900, prev_close: 890, day_high: 905, day_low: 880, day_vwap: 892 },
          marketStatus: { is_market_open: false, market_session: "closed", next_open: "2026-05-05 09:30 ET" },
          earningsEvent: {
            symbol: "NVDA",
            company_name: "NVIDIA Corp",
            report_date: tomorrow,
            report_time: "after_market",
            estimated_eps: 5.45
          },
          newsArticles: [
            {
              article_id: "n1",
              title: "NVIDIA supply chain demand remains strong",
              tickers: ["NVDA"],
              published_at: "2026-05-04T18:00:00Z",
              url: "https://example.com/nvda"
            }
          ],
          isInDefaultWatchlist: false,
          watchlistCheckComplete: true
        })
      )
    );
    expect(html).toContain("NVIDIA supply chain demand remains strong");
    expect(html).toContain("Get notified when NVDA signal fires.");
    expect(html).toContain("Signal available at: 9:30 AM ET");
  });
});
