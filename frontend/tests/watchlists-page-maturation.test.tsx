import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WatchlistsPageClient } from "@/components/watchlists-page-client";
import { ThemeProvider } from "@/lib/theme-provider";

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
                state: "actionable",
                label: "Actionable",
                readiness_label: "Ready for next session"
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

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTitle("Ready for next session")).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalled();
    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : String(c[0])
    );
    expect(urls.some((u) => u.includes("/maturation-summary?mode=day"))).toBe(true);
    expect(urls.some((u) => u.includes("alert_type=watchlist_maturation"))).toBe(true);
    expect(urls.some((u) => u.includes("symbols=AAPL"))).toBe(true);
  });

  it("uses swing mode in the maturation-summary query when maturationSummaryMode is swing", async () => {
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

    wrap(<WatchlistsPageClient maturationSummaryMode="swing" />);

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : String(c[0])
    );
    expect(urls.some((u) => u.includes("mode=swing"))).toBe(true);
  });

  it("does not request maturation-summary when the only list is not default", async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary")) {
        return Promise.resolve({ ok: true, json: async () => ({ by_symbol: {} }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          watchlists: [
            {
              watchlist_id: "wl-custom",
              name: "Custom",
              symbols: ["AAPL"],
              is_default: false
            }
          ]
        })
      });
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient />);

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    const urls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      typeof c[0] === "string" ? c[0] : String(c[0])
    );
    expect(urls.some((u) => u.includes("maturation-summary"))).toBe(false);
  });

  it("clears maturation UI on a non-default list and refetches when returning to default", async () => {
    let maturationCalls = 0;
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alerts/history")) {
        return emptyAlertsHistory();
      }
      if (url.includes("/maturation-summary")) {
        maturationCalls += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            by_symbol: {
              AAPL: {
                state: "actionable",
                label: "Actionable",
                readiness_label: "Ready on default"
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
              },
              {
                watchlist_id: "wl-other",
                name: "Other",
                symbols: ["MSFT"],
                is_default: false
              }
            ]
          })
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }) as unknown as typeof fetch;

    wrap(<WatchlistsPageClient />);

    await waitFor(() => expect(screen.getByTitle("Ready on default")).toBeInTheDocument());
    expect(maturationCalls).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Other" }));

    await waitFor(() => expect(screen.queryByTitle("Ready on default")).not.toBeInTheDocument());
    expect(screen.getByText(/readiness vs the engine/i)).toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();
    expect(maturationCalls).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: /Main/i }));

    await waitFor(() => expect(screen.getByTitle("Ready on default")).toBeInTheDocument());
    expect(maturationCalls).toBe(2);
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

    wrap(<WatchlistsPageClient maturationSummaryMode="swing" />);

    await waitFor(() => expect(screen.getByTestId("watchlist-maturation-alerts-feed")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/STOCVEST · AAPL \(swing\) maturation: Actionable → Developing/)).toBeInTheDocument());
    const feed = screen.getByTestId("watchlist-maturation-alerts-feed");
    const symLink = within(feed).getByRole("link", { name: /Open AAPL on Signals/i });
    expect(symLink.getAttribute("href")).toContain("/dashboard/signals");
    expect(symLink.getAttribute("href")).toContain("ref=watchlist");
    expect(symLink.getAttribute("href")).toContain("trading_mode=swing");
  });
});
