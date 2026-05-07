import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import ModelPortfolioPage from "@/app/portfolio/page";
import { ThemeProvider } from "@/lib/theme-provider";

const PORTFOLIO_MAIN_TAB_KEY = "stocvest_portfolio_tab";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  });
});

function jsonSummary() {
  return {
    summary: {
      closed_positions: 0,
      winning_positions: 0,
      win_rate: 0,
      total_return_dollars: 0,
      total_return_pct: 0,
      profit_factor: 0
    },
    disclaimer: "Not investment advice."
  };
}

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("Signal portfolio Day / Swing tabs", () => {
  beforeEach(() => {
    localStorage.removeItem(PORTFOLIO_MAIN_TAB_KEY);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo) => {
        const u = String(url);
        if (u.includes("/api/stocvest/portfolio/summary")) {
          return { ok: true, json: async () => jsonSummary() } as Response;
        }
        if (u.includes("/api/stocvest/portfolio/positions/open")) {
          return { ok: true, json: async () => ({ positions: [] }) } as Response;
        }
        if (u.includes("/api/stocvest/portfolio/positions/history")) {
          return { ok: true, json: async () => ({ positions: [] }) } as Response;
        }
        if (u.includes("/api/stocvest/portfolio/performance")) {
          return { ok: true, json: async () => ({ by_signal_strength: {} }) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.removeItem(PORTFOLIO_MAIN_TAB_KEY);
  });

  test("test_default_tab_is_swing", async () => {
    wrap(<ModelPortfolioPage />);
    const swing = screen.getByRole("tab", { name: /Swing Signals/i });
    await waitFor(() => expect(swing).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("heading", { name: /Swing Signal Track Record/i })).toBeInTheDocument();
  });

  test("test_day_tab_shows_portfolio_data", async () => {
    wrap(<ModelPortfolioPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Swing Signals/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /Day Signals/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Active positions/i })).toBeInTheDocument());
  });

  test("test_swing_tab_shows_coming_soon", async () => {
    wrap(<ModelPortfolioPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Swing Signals/i })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByText(/daily close/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to Scanner/i })).toHaveAttribute("href", "/dashboard/scanner");
    expect(screen.getByRole("link", { name: /Go to Signals/i })).toHaveAttribute("href", "/dashboard/signals");
  });

  test("test_tab_persists_in_localstorage", async () => {
    const r1 = wrap(<ModelPortfolioPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Day Signals/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: /Day Signals/i }));
    await waitFor(() => expect(localStorage.getItem(PORTFOLIO_MAIN_TAB_KEY)).toBe("day"));
    r1.unmount();

    wrap(<ModelPortfolioPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Day Signals/i })).toHaveAttribute("aria-selected", "true"));
  });
});
