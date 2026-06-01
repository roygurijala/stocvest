import type { ReactElement } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  NewsPanel,
  analystActionToneForTests,
  sentimentImpactLabelForTests,
  sentimentLabelForTests,
  sentimentDotClassForTests,
  sourceBadgeClassForTests
} from "@/components/news-panel";
import { tickerNewsCacheClear } from "@/lib/api/ticker-news-panel";
import { ThemeProvider } from "@/lib/theme-provider";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
}));

function panelJson(overrides: Record<string, unknown>) {
  return {
    symbol: "AAPL",
    has_recent_news: true,
    recent_cutoff_hours: 8,
    articles: [] as unknown[],
    total_found: 0,
    oldest_included: null,
    analyst: {
      feed_state: "empty",
      window_days: 30,
      consensus: null,
      ratings: [],
      total_found: 0,
      symbol: "AAPL"
    },
    ...overrides
  };
}

const sampleAnalystRating = {
  id: "goldman-20260506",
  firm: "Goldman Sachs",
  action: "Upgrade",
  rating: "Buy",
  price_target: 220,
  upside_pct: 12.5,
  firm_tier: "tier_1",
  published_at: "2026-05-06T14:00:00.000Z",
  age_label: "2h ago"
};

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("NewsPanel", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    tickerNewsCacheClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    tickerNewsCacheClear();
  });

  test("test_news_panel_shows_info_banner_when_no_recent", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        panelJson({
          has_recent_news: false,
          articles: [
            {
              id: "1",
              title: "Old story",
              source: "polygon",
              source_label: "Polygon",
              published_at: "2026-05-05T12:00:00Z",
              sentiment_score: 0,
              sentiment_label: "neutral",
              catalyst_type: null,
              url: "https://example.com",
              is_recent: false,
              age_label: "Yesterday"
            }
          ],
          total_found: 1
        })
    }) as unknown as typeof fetch;

    wrap(<NewsPanel symbol="AAPL" isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/no articles in the last 8 hours/i)).toBeInTheDocument());
    expect(screen.getAllByText(/20-day archive/i).length).toBeGreaterThanOrEqual(1);
  });

  test("test_news_panel_no_banner_when_recent_exists", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        panelJson({
          has_recent_news: true,
          articles: [
            {
              id: "1",
              title: "Fresh",
              source: "polygon",
              source_label: "Polygon",
              published_at: "2026-05-06T15:30:00Z",
              sentiment_score: 0.1,
              sentiment_label: "neutral",
              catalyst_type: null,
              url: null,
              is_recent: true,
              age_label: "30m ago"
            }
          ],
          total_found: 1
        })
    }) as unknown as typeof fetch;

    wrap(<NewsPanel symbol="AAPL" isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Fresh")).toBeInTheDocument());
    expect(screen.queryByText(/No news in the last 4h/i)).toBeNull();
  });

  test("summary uses qualitative sentiment impact labels (no raw averages)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        panelJson({
          has_recent_news: true,
          articles: [
            {
              id: "1",
              title: "Strong article",
              source: "polygon",
              source_label: "Polygon",
              published_at: "2026-05-06T15:30:00Z",
              sentiment_score: 0.55,
              sentiment_label: "bullish",
              catalyst_type: null,
              url: null,
              is_recent: true,
              age_label: "30m ago"
            }
          ],
          total_found: 1
        })
    }) as unknown as typeof fetch;

    wrap(<NewsPanel symbol="AAPL" isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Strong article")).toBeInTheDocument());
    const summary = screen.getByText(/articles · bullish tilt/i);
    expect(summary.textContent).toMatch(/medium impact/i);
    expect(summary.textContent).not.toMatch(/[+-]0\.\d+/);
  });

  test("test_news_panel_groups_by_date", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-06T16:00:00.000Z"));
    const todayIso = "2026-05-06T15:00:00.000Z";
    const yIso = "2026-05-05T15:00:00.000Z";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        panelJson({
          has_recent_news: true,
          articles: [
            {
              id: "t",
              title: "Today item",
              source: "polygon",
              source_label: "Polygon",
              published_at: todayIso,
              sentiment_score: 0,
              sentiment_label: "neutral",
              catalyst_type: null,
              url: "https://a.com",
              is_recent: true,
              age_label: "2h ago"
            },
            {
              id: "y",
              title: "Yesterday item",
              source: "polygon",
              source_label: "Polygon",
              published_at: yIso,
              sentiment_score: 0,
              sentiment_label: "neutral",
              catalyst_type: null,
              url: "https://b.com",
              is_recent: false,
              age_label: "Yesterday"
            }
          ],
          total_found: 2
        })
    }) as unknown as typeof fetch;

    try {
      wrap(<NewsPanel symbol="AAPL" isOpen onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByText("TODAY")).toBeInTheDocument());
      expect(screen.getByText("YESTERDAY")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test("test_news_panel_skeleton_during_load", async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    wrap(<NewsPanel symbol="AAPL" isOpen onClose={vi.fn()} />);
    await waitFor(() => {
      expect(document.querySelector(".animate-pulse")).toBeTruthy();
    });
  });

  test("test_news_panel_empty_state", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => panelJson({ articles: [], total_found: 0, has_recent_news: false })
    }) as unknown as typeof fetch;

    wrap(<NewsPanel symbol="ZZZ" isOpen onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/No ZZZ-tagged headlines passed quality filters/i)).toBeInTheDocument()
    );
  });

  test("test_news_panel_caches_per_ticker", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        panelJson({
          symbol: "AAPL",
          articles: [
            {
              id: "1",
              title: "One",
              source: "polygon",
              source_label: "Polygon",
              published_at: "2026-05-06T12:00:00Z",
              sentiment_score: 0,
              sentiment_label: "neutral",
              catalyst_type: null,
              url: "https://x.com",
              is_recent: true,
              age_label: "1h ago"
            }
          ],
          total_found: 1,
          has_recent_news: true
        })
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const { rerender } = wrap(<NewsPanel symbol="AAPL" isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("One")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(
      <ThemeProvider>
        <NewsPanel symbol="AAPL" isOpen={false} onClose={vi.fn()} />
      </ThemeProvider>
    );
    rerender(
      <ThemeProvider>
        <NewsPanel symbol="AAPL" isOpen onClose={vi.fn()} />
      </ThemeProvider>
    );
    await waitFor(() => expect(screen.getByText("One")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("test_article_card_opens_url_on_click", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        panelJson({
          articles: [
            {
              id: "1",
              title: "Click me",
              source: "polygon",
              source_label: "Polygon",
              published_at: "2026-05-06T12:00:00Z",
              sentiment_score: 0,
              sentiment_label: "neutral",
              catalyst_type: null,
              url: "https://news.example/article",
              is_recent: true,
              age_label: "1h ago"
            }
          ],
          total_found: 1,
          has_recent_news: true
        })
    }) as unknown as typeof fetch;

    wrap(<NewsPanel symbol="AAPL" isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Click me")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Click me"));
    expect(openSpy).toHaveBeenCalledWith("https://news.example/article", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  test("renders analyst ratings section when API includes analyst data", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        panelJson({
          analyst: {
            feed_state: "available",
            window_days: 30,
            consensus: {
              upgrades_30d: 3,
              downgrades_30d: 0,
              momentum: 3,
              label: "Analyst consensus improving",
              unique_firms: true
            },
            ratings: [sampleAnalystRating],
            total_found: 1,
            symbol: "AAPL"
          },
          articles: [
            {
              id: "1",
              title: "Fresh headline",
              source: "polygon",
              source_label: "Polygon",
              published_at: "2026-05-06T15:30:00Z",
              sentiment_score: 0.1,
              sentiment_label: "neutral",
              catalyst_type: null,
              url: null,
              is_recent: true,
              age_label: "30m ago"
            }
          ],
          total_found: 1
        })
    }) as unknown as typeof fetch;

    wrap(<NewsPanel symbol="AAPL" isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("analyst-panel-section")).toBeInTheDocument());
    expect(screen.getByText(/Goldman Sachs/)).toBeInTheDocument();
    expect(screen.getByText(/Analyst consensus improving/)).toBeInTheDocument();
    expect(screen.getByText("Headlines")).toBeInTheDocument();
    expect(screen.getByText("Fresh headline")).toBeInTheDocument();
  });

  test("shows analyst feed unavailable banner when unconfigured", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        panelJson({
          analyst: {
            feed_state: "unconfigured",
            window_days: 30,
            consensus: null,
            ratings: [],
            total_found: 0,
            symbol: "AAPL"
          }
        })
    }) as unknown as typeof fetch;

    wrap(<NewsPanel symbol="AAPL" isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("analyst-feed-unavailable-banner")).toBeInTheDocument());
  });
});

describe("news panel chrome", () => {
  test("test_sentiment_dot_colors", () => {
    expect(sentimentDotClassForTests(0.85)).toContain("emerald");
    expect(sentimentDotClassForTests(-0.6)).toContain("rose");
    expect(sentimentDotClassForTests(0.05)).toContain("slate");
  });

  test("test_source_badge_labels", () => {
    expect(sourceBadgeClassForTests("benzinga")).toContain("orange");
    expect(sourceBadgeClassForTests("sec_edgar")).toContain("sky");
    expect(sourceBadgeClassForTests("polygon")).toContain("slate");
  });

  test("sentiment impact labels map from score", () => {
    expect(sentimentLabelForTests(0.55)).toBe("bullish");
    expect(sentimentImpactLabelForTests(0.55)).toBe("medium impact");
    expect(sentimentLabelForTests(-0.8)).toBe("bearish");
    expect(sentimentImpactLabelForTests(-0.8)).toBe("high impact");
    expect(sentimentLabelForTests(0.1)).toBe("mixed");
    expect(sentimentImpactLabelForTests(0.1)).toBe("low impact");
  });

  test("analyst action tone classification", () => {
    expect(analystActionToneForTests("Upgrade")).toBe("bullish");
    expect(analystActionToneForTests("Downgrade")).toBe("bearish");
    expect(analystActionToneForTests("Maintains")).toBe("neutral");
  });
});
