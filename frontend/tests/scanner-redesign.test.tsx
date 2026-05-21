import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeAll, describe, expect, test } from "vitest";

import { MarketConditionsCard } from "@/components/scanner/MarketConditionsCard";
import { NearMissSection } from "@/components/scanner/NearMissSection";
import { RejectionGroups } from "@/components/scanner/RejectionGroups";
import { WhatWouldChangeFooter } from "@/components/scanner/WhatWouldChangeFooter";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
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
});

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const baseSynthesis: ScannerSynthesis = {
  qualified_count: 0,
  market_summary:
    "Broad market volume is running 68–88% below expected intraday pace. Scanner rejections reflect market-wide inactivity.",
  what_would_change: "Watch SPY and QQQ for session pace recovery when participation firms up.",
  session_time_et: "11:24 AM",
  volume_context: {
    avg_pct_below: 79,
    trend: "stable",
    time_of_day: "mid",
    recovery_likely: false,
    market_condition: "Low participation"
  },
  near_misses: [],
  rejection_groups: {
    session_volume: [],
    liquidity: [],
    structure: []
  }
};

describe("scanner redesign components", () => {
  test("test_market_conditions_card_renders_summary", () => {
    wrap(<MarketConditionsCard synthesis={baseSynthesis} />);
    expect(screen.getByTestId("scanner-market-summary")).toHaveTextContent(/Broad market volume/);
  });

  test("test_near_miss_section_not_rendered_when_empty", () => {
    const { container } = wrap(<NearMissSection nearMisses={[]} />);
    expect(container.querySelector('[data-testid="scanner-near-miss-section"]')).toBeNull();
  });

  test("test_near_miss_volume_bar_correct_width", () => {
    wrap(
      <NearMissSection
        nearMisses={[
          {
            symbol: "SPY",
            pct_of_needed: 32,
            structure_note: "Session pace lagging",
            is_market_proxy: false
          }
        ]}
      />
    );
    const fill = screen.getByTestId("scanner-near-miss-bar-fill-SPY");
    expect(fill).toHaveStyle({ width: "32%" });
  });

  test("test_market_proxy_shows_special_note", () => {
    wrap(
      <NearMissSection
        nearMisses={[
          {
            symbol: "SPY",
            pct_of_needed: 20,
            structure_note: "Note",
            is_market_proxy: true
          }
        ]}
      />
    );
    expect(screen.getByText(/broader pickup/i)).toBeTruthy();
  });

  test("test_rejection_groups_session_volume_chips", () => {
    wrap(
      <RejectionGroups
        groups={{
          session_volume: [
            { symbol: "SPY", pct_below: 68 },
            { symbol: "QQQ", pct_below: 70 },
            { symbol: "NVDA", pct_below: 80 },
            { symbol: "AAPL", pct_below: 82 },
            { symbol: "MSFT", pct_below: 88 }
          ],
          liquidity: [],
          structure: []
        }}
      />
    );
    fireEvent.click(screen.getByTestId("scanner-rejection-session-volume-toggle"));
    expect(screen.getAllByTestId(/scanner-rejection-volume-gap-.*-fill/)).toHaveLength(5);
    expect(screen.getByTestId("scanner-rejection-volume-gap-SPY-fill")).toHaveStyle({ width: "32%" });
    expect(screen.getByTestId("scanner-rejection-volume-gap-SPY-rank-note")).toHaveTextContent(
      /still below threshold/i
    );
    expect(screen.queryByText(/−68%/)).toBeNull();
  });

  test("test_liquidity_group_closed_by_default", () => {
    wrap(
      <RejectionGroups
        groups={{
          session_volume: [],
          liquidity: [{ symbol: "WARP" }, { symbol: "CCM" }],
          structure: []
        }}
      />
    );
    expect(screen.queryByTestId("scanner-rejection-liquidity-chip-WARP")).toBeNull();
    fireEvent.click(screen.getByTestId("scanner-rejection-liquidity-toggle"));
    expect(screen.getByTestId("scanner-rejection-liquidity-chip-WARP")).toBeTruthy();
  });

  test("test_permanent_filter_note_visible", () => {
    wrap(
      <RejectionGroups
        groups={{
          session_volume: [],
          liquidity: [{ symbol: "WARP" }],
          structure: []
        }}
      />
    );
    fireEvent.click(screen.getByTestId("scanner-rejection-liquidity-toggle"));
    expect(screen.getByTestId("scanner-rejection-liquidity-note")).toHaveTextContent(/any day/i);
  });

  test("test_old_flat_rejection_list_not_present", () => {
    wrap(<RejectionGroups groups={baseSynthesis.rejection_groups} />);
    expect(screen.queryByText(/did not qualify/i)).toBeNull();
    expect(screen.queryByTestId("scanner-evaluation-trace-list")).toBeNull();
  });

  test("test_what_would_change_renders_when_set", () => {
    wrap(<WhatWouldChangeFooter text={baseSynthesis.what_would_change} />);
    expect(screen.getByTestId("scanner-what-would-change")).toHaveTextContent(/SPY and QQQ/);
  });
});
