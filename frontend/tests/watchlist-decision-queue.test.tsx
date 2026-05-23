import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WatchlistDecisionQueue } from "@/components/watchlists/watchlist-decision-queue";
import { ThemeProvider } from "@/lib/theme-provider";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";

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

vi.mock("@/components/nav/signals-deeplink-link", () => ({
  SignalsDeeplinkLink: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  )
}));

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function row(partial: Partial<WatchlistMaturationRow>): WatchlistMaturationRow {
  return partial as WatchlistMaturationRow;
}

describe("WatchlistDecisionQueue layout", () => {
  it("renders check_now as a non-collapsible section", () => {
    wrap(
      <WatchlistDecisionQueue
        symbols={["NVDA"]}
        planMode="swing"
        rowForSymbol={() =>
          row({ state: "actionable", layers_aligned: 6, layers_total: 6, label: "Actionable" })
        }
        snapshotForSymbol={() => undefined}
        onRemove={() => undefined}
      />
    );
    expect(screen.getByTestId("watchlist-tier-check_now").tagName).toBe("SECTION");
    expect(screen.getByTestId("watchlist-decision-card-NVDA")).toBeInTheDocument();
  });

  it("uses a two-column grid class for tracking when 3+ symbols", () => {
    const trackingRow = row({ state: "not_aligned", layers_aligned: 1, layers_total: 6 });
    wrap(
      <WatchlistDecisionQueue
        symbols={["AAA", "BBB", "CCC"]}
        planMode="swing"
        rowForSymbol={() => trackingRow}
        snapshotForSymbol={() => undefined}
        onRemove={() => undefined}
      />
    );
    const list = screen.getByTestId("watchlist-tier-list-tracking");
    expect(list.className).toMatch(/lg:grid-cols-2/);
  });

  it("shows just added badge when requested", () => {
    wrap(
      <WatchlistDecisionQueue
        symbols={["TSLA"]}
        planMode="swing"
        rowForSymbol={() => undefined}
        snapshotForSymbol={() => undefined}
        onRemove={() => undefined}
        justAddedSymbol="TSLA"
      />
    );
    expect(screen.getByTestId("watchlist-badge-just-added-TSLA")).toHaveTextContent("Just added");
  });

  it("sorts alphabetically within tier when sortMode is alphabetical", () => {
    wrap(
      <WatchlistDecisionQueue
        symbols={["ZZZ", "AAA", "MMM"]}
        planMode="swing"
        sortMode="alphabetical"
        rowForSymbol={() => row({ layers_aligned: 1, layers_total: 6, state: "not_aligned" })}
        snapshotForSymbol={() => undefined}
        onRemove={() => undefined}
      />
    );
    const list = screen.getByTestId("watchlist-tier-list-tracking");
    expect(list.textContent?.indexOf("AAA")).toBeLessThan(list.textContent?.indexOf("MMM") ?? 0);
    expect(list.textContent?.indexOf("MMM")).toBeLessThan(list.textContent?.indexOf("ZZZ") ?? 0);
  });

  it("renders compact tracking cards when enabled", () => {
    wrap(
      <WatchlistDecisionQueue
        symbols={["SOFI"]}
        planMode="swing"
        sortMode="attention"
        trackingCompact
        rowForSymbol={() => row({ layers_aligned: 1, layers_total: 6, state: "not_aligned" })}
        snapshotForSymbol={() => undefined}
        onRemove={() => undefined}
      />
    );
    expect(screen.getByTestId("watchlist-decision-card-SOFI")).toHaveAttribute(
      "data-watchlist-card-density",
      "compact"
    );
  });

  it("exposes check now section anchor for sticky jump", () => {
    wrap(
      <WatchlistDecisionQueue
        symbols={["NVDA"]}
        planMode="swing"
        rowForSymbol={() =>
          row({ state: "actionable", layers_aligned: 6, layers_total: 6, label: "Actionable" })
        }
        snapshotForSymbol={() => undefined}
        onRemove={() => undefined}
      />
    );
    expect(document.getElementById("watchlist-tier-check_now")).toBeInTheDocument();
    expect(screen.getByTestId("watchlist-check-now-sentinel")).toBeInTheDocument();
  });
});
