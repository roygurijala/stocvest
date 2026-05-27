import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WatchlistDeskCompareSheet } from "@/components/watchlists/watchlist-desk-compare-sheet";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("WatchlistDeskCompareSheet", () => {
  it("renders swing and day blocks with updated lines", () => {
    const onClose = vi.fn();
    wrap(
      <WatchlistDeskCompareSheet
        open
        symbol="AAPL"
        swingRow={{
          state: "developing",
          layers_aligned: 3,
          layers_total: 6,
          last_evaluated_at: new Date(Date.now() - 3_600_000).toISOString()
        }}
        dayRow={{
          state: "near_ready",
          layers_aligned: 4,
          layers_total: 6,
          last_evaluated_at: new Date(Date.now() - 86_400_000).toISOString()
        }}
        onClose={onClose}
      />
    );
    expect(screen.getByTestId("watchlist-desk-compare-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("watchlist-compare-desk-swing")).toBeInTheDocument();
    expect(screen.getByTestId("watchlist-compare-desk-day")).toBeInTheDocument();
    expect(screen.getByTestId("watchlist-compare-updated-swing")).toHaveTextContent(/Updated:/);
    expect(screen.getByTestId("watchlist-compare-updated-day")).toHaveTextContent(/Updated:/);
  });

  it("calls onRefreshDesk per desk", () => {
    const onRefreshDesk = vi.fn();
    wrap(
      <WatchlistDeskCompareSheet
        open
        symbol="AAPL"
        swingRow={{ state: "developing", layers_aligned: 2, layers_total: 6 }}
        dayRow={{ state: "developing", layers_aligned: 2, layers_total: 6 }}
        onClose={() => undefined}
        onRefreshDesk={onRefreshDesk}
      />
    );
    fireEvent.click(screen.getByTestId("watchlist-compare-refresh-day"));
    expect(onRefreshDesk).toHaveBeenCalledWith("day");
  });
});
