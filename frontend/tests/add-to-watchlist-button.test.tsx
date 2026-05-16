import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { ThemeProvider } from "@/lib/theme-provider";
import { invalidateWatchlistMembershipCache } from "@/lib/watchlist-membership-client";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("AddToWatchlistButton", () => {
  beforeEach(() => {
    invalidateWatchlistMembershipCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/stocvest/watchlists") && !url.includes("/symbols/")) {
          return new Response(
            JSON.stringify({
              watchlists: [{ watchlist_id: "wl-1", is_default: true, symbols: ["TSLA"] }]
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/api/stocvest/watchlists/default/symbols")) {
          return new Response(
            JSON.stringify({
              symbols: ["TSLA"],
              symbol_tracking: { TSLA: { swing: true, day: true } }
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }) as typeof fetch
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    invalidateWatchlistMembershipCache();
  });

  test("shows In Watchlist and opens popover for symbols on the default list", async () => {
    wrap(<AddToWatchlistButton symbol="TSLA" />);
    const btn = await screen.findByRole("button", { name: /in watchlist/i });
    fireEvent.click(btn);
    expect(await screen.findByRole("dialog")).toHaveTextContent(/TSLA is already in your watchlist/i);
    expect(screen.getByLabelText(/swing/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/day/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view in watchlist/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove from watchlist/i })).toBeInTheDocument();
  });

  test("shows + Watchlist when symbol is not on the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/stocvest/watchlists")) {
          return new Response(
            JSON.stringify({
              watchlists: [{ watchlist_id: "wl-1", is_default: true, symbols: ["AAPL"] }]
            }),
            { status: 200 }
          );
        }
        if (url.endsWith("/api/stocvest/watchlists/default/symbols")) {
          return new Response(JSON.stringify({ symbols: ["AAPL"] }), { status: 200 });
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }) as typeof fetch
    );
    invalidateWatchlistMembershipCache();
    wrap(<AddToWatchlistButton symbol="NVDA" />);
    expect(await screen.findByRole("button", { name: /\+ watchlist/i })).toBeInTheDocument();
  });
});
