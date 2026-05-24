import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { WatchlistOrderExplainer } from "@/components/watchlists/watchlist-order-explainer";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: React.ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("WatchlistOrderExplainer", () => {
  test("renders grouping and attention sort copy", () => {
    wrap(<WatchlistOrderExplainer sortMode="attention" />);
    expect(screen.getByTestId("watchlist-order-explainer")).toBeTruthy();
    expect(screen.getByText("How symbols are ordered")).toBeTruthy();
    expect(screen.getByText(/Check now — 4–6 of 6 layers aligned/)).toBeTruthy();
    expect(screen.getByText(/Current sort \(Attention\):/)).toBeTruthy();
    expect(screen.getByText(/all 5\/6/)).toBeTruthy();
  });

  test("updates detail when sort mode changes", () => {
    const { rerender } = wrap(<WatchlistOrderExplainer sortMode="alphabetical" />);
    expect(screen.getByText(/Current sort \(A → Z\):/)).toBeTruthy();
    expect(screen.getByText(/ticker A→Z inside each group/)).toBeTruthy();
    rerender(
      <ThemeProvider>
        <WatchlistOrderExplainer sortMode="most_aligned" />
      </ThemeProvider>
    );
    expect(screen.getByText(/Current sort \(Most aligned\):/)).toBeTruthy();
  });
});
