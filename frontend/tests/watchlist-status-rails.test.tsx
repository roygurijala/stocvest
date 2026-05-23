import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WatchlistStatusRails } from "@/components/watchlists/WatchlistStatusRails";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: React.ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const baseCounts = {
  actionable: 2,
  developing: 1,
  notAligned: 3,
  invalidated: 0,
  monitored: 6
};

describe("WatchlistStatusRails", () => {
  it("renders read-only counts when onRailClick is omitted", () => {
    wrap(<WatchlistStatusRails counts={baseCounts} />);
    expect(screen.getByTestId("watchlist-status-rail-actionable")).toBeDisabled();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("calls onRailClick for rails with a non-zero count", () => {
    const onRailClick = vi.fn();
    wrap(<WatchlistStatusRails counts={baseCounts} onRailClick={onRailClick} />);
    fireEvent.click(screen.getByTestId("watchlist-status-rail-developing"));
    expect(onRailClick).toHaveBeenCalledWith("developing");
  });

  it("disables rails with zero count", () => {
    const onRailClick = vi.fn();
    wrap(<WatchlistStatusRails counts={baseCounts} onRailClick={onRailClick} />);
    const invalidated = screen.getByTestId("watchlist-status-rail-invalidated");
    expect(invalidated).toBeDisabled();
    fireEvent.click(invalidated);
    expect(onRailClick).not.toHaveBeenCalled();
  });

  it("marks the active rail with aria-pressed", () => {
    wrap(
      <WatchlistStatusRails counts={baseCounts} activeRail="actionable" onRailClick={() => undefined} />
    );
    expect(screen.getByTestId("watchlist-status-rail-actionable")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("watchlist-status-rail-developing")).toHaveAttribute("aria-pressed", "false");
  });
});
