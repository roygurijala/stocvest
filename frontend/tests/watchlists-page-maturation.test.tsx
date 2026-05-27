import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { WatchlistsPageClient } from "@/components/watchlists-page-client";
import { ThemeProvider } from "@/lib/theme-provider";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    })
  });
  class MockIntersectionObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    constructor(private callback: IntersectionObserverCallback) {}
    trigger(isIntersecting: boolean, target: Element) {
      this.callback([{ isIntersecting, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

vi.mock("@/lib/assistant/context", () => ({
  usePublishAssistantContext: () => undefined
}));

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function emptyAlertsHistory() {
  return Promise.resolve({ ok: true, json: async () => ({ alerts: [] }) });
}

describe("WatchlistsPageClient maturation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches maturation-summary for the default list and shows readiness under the symbol", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            by_symbol: {
              AAPL: {
                state: "developing",
                label: "Developing",
                layers_aligned: 4,
                layers_total: 6,
                readiness_label: "Ready for next session",
                previous_layers_aligned: 3,
                last_transition_type: "improved"
              }
            }
          })
        });
      }
      if (url.includes("/api/stocvest/watchlists") && !url.includes("/watchlists/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            watchlists: [
              {
                watchlist_id: "wl-default",
                name: "Main",
                symbols: ["AAPL"],
                is_default: true
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient />);

    await waitFor(() => {
      expect(screen.getByTestId("watchlist-evaluation-info")).toBeInTheDocument();
      expect(screen.getByTestId("watchlist-decision-card-AAPL")).toBeInTheDocument();
      expect(screen.getByTestId("watchlist-tier-check_now")).toBeInTheDocument();
    });
    const card = screen.getByTestId("watchlist-decision-card-AAPL");
    expect(within(card).getByText("(4/6)")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("watchlist-badge-improved-AAPL")).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalled();
    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : String(c[0])
    );
    expect(urls.some((u) => u.includes("/maturation-summary?mode=swing"))).toBe(true);
    expect(urls.some((u) => u.includes("alert_type=watchlist_maturation"))).toBe(true);
    expect(urls.some((u) => u.includes("symbols=AAPL"))).toBe(true);
  });

  it("uses swing mode in the maturation-summary query when dualDeskMaturation is false", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            by_symbol: {
              AAPL: { state: "developing", label: "Developing", readiness_label: "Swing path" }
            }
          })
        });
      }
      if (url.includes("/api/stocvest/watchlists") && !url.includes("/watchlists/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            watchlists: [
              {
                watchlist_id: "wl-default",
                name: "Main",
                symbols: ["AAPL"],
                is_default: true
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient dualDeskMaturation={false} />);

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    await waitFor(() => {
      const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
        typeof c[0] === "string" ? c[0] : String(c[0])
      );
      expect(urls.some((u) => u.includes("maturation-summary") && u.includes("mode=swing"))).toBe(true);
    });
  });

  it("shows maturation on rows when day summary fails but swing succeeds (dual desk)", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary") && url.includes("mode=day")) {
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }
      if (url.includes("/maturation-summary") && url.includes("mode=swing")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            by_symbol: {
              AAPL: {
                state: "developing",
                label: "Developing",
                layers_aligned: 4,
                layers_total: 6
              }
            }
          })
        });
      }
      if (url.includes("/api/stocvest/watchlists") && !url.includes("/watchlists/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            watchlists: [
              {
                watchlist_id: "wl-default",
                name: "Main",
                symbols: ["AAPL"],
                is_default: true
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient dualDeskMaturation={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("watchlist-decision-card-AAPL")).toBeInTheDocument();
      expect(screen.getByTestId("watchlist-tier-check_now")).toBeInTheDocument();
    });
    expect(screen.queryByText("Could not load maturation")).not.toBeInTheDocument();
    expect(screen.queryByTestId("watchlist-maturation-error")).not.toBeInTheDocument();
  });

  it("shows a single maturation error banner when swing summary fails", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary")) {
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }
      if (url.includes("/api/stocvest/watchlists") && !url.includes("/watchlists/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            watchlists: [
              {
                watchlist_id: "wl-default",
                name: "Main",
                symbols: ["AAPL"],
                is_default: true
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient />);

    await waitFor(() => expect(screen.getByTestId("watchlist-maturation-error")).toBeInTheDocument());
    expect(screen.queryByText("Could not load maturation")).not.toBeInTheDocument();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("fetches swing and day maturation when dualDeskMaturation is true", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            by_symbol: {
              AAPL: { state: "actionable", label: "Actionable", readiness_label: "Ok" }
            }
          })
        });
      }
      if (url.includes("/api/stocvest/watchlists") && !url.includes("/watchlists/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            watchlists: [
              {
                watchlist_id: "wl-default",
                name: "Main",
                symbols: ["AAPL"],
                is_default: true
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient dualDeskMaturation={true} />);

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    await waitFor(() => {
      const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
        typeof c[0] === "string" ? c[0] : String(c[0])
      );
      expect(urls.filter((u) => u.includes("maturation-summary") && u.includes("mode=swing")).length).toBeGreaterThanOrEqual(
        1
      );
      expect(urls.filter((u) => u.includes("maturation-summary") && u.includes("mode=day")).length).toBeGreaterThanOrEqual(
        1
      );
    });
  });

  it("does not request maturation-summary when the watchlist has no symbols", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary")) {
        return Promise.resolve({ ok: true, json: async () => ({ by_symbol: {} }) });
      }
      if (url.includes("/api/stocvest/watchlists") && !url.includes("/watchlists/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            watchlists: [
              {
                watchlist_id: "wl-default",
                name: "Main",
                symbols: [],
                is_default: true
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient />);

    await waitFor(() => expect(screen.getByRole("heading", { name: /^Watchlist$/ })).toBeInTheDocument());
    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : String(c[0])
    );
    expect(urls.some((u) => u.includes("maturation-summary"))).toBe(false);
  });

  it("shows recent watchlist_maturation rows from alert history on the default list", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            alerts: [
              {
                alert_type: "watchlist_maturation",
                symbol: "AAPL",
                title: "STOCVEST · AAPL (swing) maturation: Actionable → Developing",
                created_at: "2026-05-15T16:00:00+00:00",
                status: "sent"
              },
              {
                alert_type: "signal_fired",
                symbol: "AAPL",
                title: "Signal",
                created_at: "2026-05-15T15:00:00+00:00",
                status: "sent"
              }
            ]
          })
        });
      }
      if (url.includes("/maturation-summary")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            by_symbol: {
              AAPL: { state: "developing", label: "Developing", readiness_label: "Core ok" }
            }
          })
        });
      }
      if (url.includes("/api/stocvest/watchlists") && !url.includes("/watchlists/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            watchlists: [
              {
                watchlist_id: "wl-default",
                name: "Main",
                symbols: ["AAPL"],
                is_default: true
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient dualDeskMaturation={false} />);

    await waitFor(() => expect(screen.getByTestId("watchlist-activity")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Recent activity"));
    await waitFor(() => expect(screen.getByText(/STOCVEST · AAPL \(swing\) maturation: Actionable → Developing/)).toBeInTheDocument());
    const feed = screen.getByTestId("watchlist-activity");
    const symLink = within(feed).getByRole("link", { name: /Open AAPL on Signals/i });
    expect(symLink.getAttribute("href")).toContain("/dashboard/signals");
    expect(symLink.getAttribute("href")).toContain("ref=watchlist");
    expect(symLink.getAttribute("href")).toContain("trading_mode=swing");
  });

  it("shows Swing and Day tabs with Compare desks link when dualDeskMaturation", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            by_symbol: {
              AAPL: {
                state: "developing",
                label: "Developing",
                layers_aligned: 3,
                layers_total: 6,
                last_evaluated_at: "2026-05-26T14:00:00+00:00"
              }
            }
          })
        });
      }
      if (url.includes("/api/stocvest/watchlists") && !url.includes("/watchlists/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            watchlists: [
              {
                watchlist_id: "wl-default",
                name: "Main",
                symbols: ["AAPL"],
                is_default: true
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient dualDeskMaturation={true} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Swing" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Day" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Both" })).not.toBeInTheDocument();
      expect(screen.getByTestId("watchlist-compare-desks-AAPL")).toBeInTheDocument();
    });
  });

  it("does not show Day tab or Compare desks when dualDeskMaturation is false", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            by_symbol: {
              AAPL: { state: "developing", label: "Developing", layers_aligned: 3, layers_total: 6 }
            }
          })
        });
      }
      if (url.includes("/api/stocvest/watchlists") && !url.includes("/watchlists/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            watchlists: [
              {
                watchlist_id: "wl-default",
                name: "Main",
                symbols: ["AAPL"],
                is_default: true
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient dualDeskMaturation={false} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Swing" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Day" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("watchlist-compare-desks-AAPL")).not.toBeInTheDocument();
    });
    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : String(c[0])
    );
    expect(urls.some((u) => u.includes("maturation-summary") && u.includes("mode=day"))).toBe(false);
  });

  it("filters cards when a maturation status rail is clicked", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            by_symbol: {
              AAPL: {
                state: "developing",
                label: "Developing",
                layers_aligned: 3,
                layers_total: 6
              },
              MSFT: {
                state: "not_aligned",
                label: "Not aligned",
                layers_aligned: 1,
                layers_total: 6
              }
            }
          })
        });
      }
      if (url.includes("/api/stocvest/watchlists") && !url.includes("/watchlists/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            watchlists: [
              {
                watchlist_id: "wl-default",
                name: "Main",
                symbols: ["AAPL", "MSFT"],
                is_default: true
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient />);

    await waitFor(() => {
      expect(screen.getByTestId("watchlist-decision-card-AAPL")).toBeInTheDocument();
      expect(screen.getByTestId("watchlist-decision-card-MSFT")).toBeInTheDocument();
      expect(screen.getByTestId("watchlist-status-rails")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("watchlist-status-rail-developing"));

    await waitFor(() => {
      expect(screen.getByTestId("watchlist-maturation-rail-filter-banner")).toBeInTheDocument();
      expect(screen.getByTestId("watchlist-decision-card-AAPL")).toBeInTheDocument();
      expect(screen.queryByTestId("watchlist-decision-card-MSFT")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("watchlist-status-rail-developing"));

    await waitFor(() => {
      expect(screen.queryByTestId("watchlist-maturation-rail-filter-banner")).not.toBeInTheDocument();
      expect(screen.getByTestId("watchlist-decision-card-MSFT")).toBeInTheDocument();
    });
  });
});
