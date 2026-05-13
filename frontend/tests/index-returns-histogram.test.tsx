/**
 * Lock-in tests for the SPY/QQQ/IWM daily-returns histogram (replaces the
 * line sparkline that used to sit inside Shared Context · Section A).
 *
 * Invariants worth pinning:
 *   • Bar count = closes.length − 1 (one bar per *daily return*, not per close).
 *   • Polarity:
 *       - Bar `data-sign` = "up" for returns above the neutral band,
 *         "down" below, "flat" inside ±0.1%.
 *       - Up bars sit ABOVE the zero baseline; down bars sit AT/BELOW the
 *         baseline. Position carries the signal independently of color.
 *   • Color:
 *       - Up bars get the bullish token. Down bars get the bearish token.
 *         Flat bars get the muted token. This matches the `getChangeColor`
 *         neutral-band already used by the % label next to the histogram —
 *         color invariants live in one place, not two.
 *   • Magnitude:
 *       - Per-card scaling: the tallest bar reaches its full vertical budget
 *         independent of what the *other* tiles are showing. We do NOT
 *         compare magnitudes across tiles in the bar viz; that's the % label's job.
 *   • Empty / degenerate input:
 *       - Fewer than 2 valid closes → component renders nothing (returns null).
 *       - Non-finite / zero / negative values are stripped before computing returns.
 *       - All-flat session does not collapse to invisible bars (we always
 *         render at least a 1px stub so the day count is preserved).
 */

import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { IndexReturnsHistogram } from "@/components/index-returns-histogram";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => cleanup());

describe("IndexReturnsHistogram — bar count + axis", () => {
  test("renders N - 1 bars from N closes", () => {
    // 6 closes → 5 daily returns → 5 bars
    wrap(<IndexReturnsHistogram closes={[100, 101, 102, 103, 104, 105]} />);
    const bars = screen.getAllByTestId(/^histogram-bar-\d+$/);
    expect(bars).toHaveLength(5);
  });

  test("renders 4 bars from 5 closes (defensive — short data does not throw)", () => {
    wrap(<IndexReturnsHistogram closes={[100, 101, 102, 103, 104]} />);
    const bars = screen.getAllByTestId(/^histogram-bar-\d+$/);
    expect(bars).toHaveLength(4);
  });

  test("renders nothing when fewer than 2 valid closes", () => {
    const { container } = wrap(<IndexReturnsHistogram closes={[100]} />);
    expect(container.querySelector('[data-testid="index-returns-histogram"]')).toBeNull();
  });

  test("renders nothing when closes is empty", () => {
    const { container } = wrap(<IndexReturnsHistogram closes={[]} />);
    expect(container.querySelector('[data-testid="index-returns-histogram"]')).toBeNull();
  });

  test("strips non-finite / zero / negative closes before computing returns", () => {
    // After stripping: [100, 102, 104] → 2 returns
    wrap(
      <IndexReturnsHistogram
        closes={[100, NaN, 102, 0, 104, -5 as number]}
      />
    );
    const bars = screen.getAllByTestId(/^histogram-bar-\d+$/);
    expect(bars).toHaveLength(2);
  });

  test("the zero-line baseline is rendered above the bars", () => {
    wrap(<IndexReturnsHistogram closes={[100, 101, 102]} />);
    expect(screen.getByTestId("histogram-zero-line")).toBeInTheDocument();
  });
});

describe("IndexReturnsHistogram — polarity (color + position)", () => {
  test("positive return → sign=up, fill matches bullish token", () => {
    // 100 → 101 = +1.00% (clearly above the ±0.1% neutral band)
    wrap(<IndexReturnsHistogram closes={[100, 101]} />);
    const bar = screen.getByTestId("histogram-bar-0");
    expect(bar.getAttribute("data-sign")).toBe("up");
    const fill = (bar.getAttribute("fill") || "").toLowerCase();
    expect(fill).not.toBe("");
    // The bullish/bearish/muted tokens come from the live theme — we don't
    // pin literal hex values here (theme can change). What we DO pin is
    // that an up bar and a down bar in the same render get DIFFERENT fills.
    wrap(<IndexReturnsHistogram closes={[100, 99]} />);
    const downBar = screen.getAllByTestId("histogram-bar-0").at(-1)!;
    expect(downBar.getAttribute("data-sign")).toBe("down");
    const downFill = (downBar.getAttribute("fill") || "").toLowerCase();
    expect(downFill).not.toBe(fill);
  });

  test("negative return → sign=down and the bar sits AT or below the zero line", () => {
    // 100 → 99 = -1.00%
    wrap(<IndexReturnsHistogram closes={[100, 99]} height={22} />);
    const bar = screen.getByTestId("histogram-bar-0");
    expect(bar.getAttribute("data-sign")).toBe("down");
    const zeroLine = screen.getByTestId("histogram-zero-line");
    const zeroY = Number(zeroLine.getAttribute("y1"));
    const barY = Number(bar.getAttribute("y"));
    // Down bars hang DOWN from the baseline, so their top edge sits at the
    // baseline (or fractionally above due to subpixel rounding).
    expect(barY).toBeGreaterThanOrEqual(zeroY - 0.5);
  });

  test("positive return → bar TOP sits above the zero line (positional polarity)", () => {
    wrap(<IndexReturnsHistogram closes={[100, 101]} height={22} />);
    const bar = screen.getByTestId("histogram-bar-0");
    const zeroLine = screen.getByTestId("histogram-zero-line");
    const zeroY = Number(zeroLine.getAttribute("y1"));
    const barY = Number(bar.getAttribute("y"));
    // Up bars grow UPWARD, so their y (top edge) is strictly above zeroY.
    expect(barY).toBeLessThan(zeroY);
  });

  test("near-flat return (|Δ| ≤ 0.1%) → sign=flat with a visible 1px stub", () => {
    // 100 → 100.05 = +0.05% — inside the neutral band
    wrap(<IndexReturnsHistogram closes={[100, 100.05]} />);
    const bar = screen.getByTestId("histogram-bar-0");
    expect(bar.getAttribute("data-sign")).toBe("flat");
    expect(Number(bar.getAttribute("height"))).toBeGreaterThanOrEqual(1);
  });

  test("five-bar mixed week renders each bar with the correct polarity", () => {
    // closes:    100  101  99   100  98   99
    // returns:    +1%  -1.98%  +1.01%  -2%   +1.02%
    wrap(<IndexReturnsHistogram closes={[100, 101, 99, 100, 98, 99]} />);
    const bars = screen.getAllByTestId(/^histogram-bar-\d+$/);
    expect(bars).toHaveLength(5);
    expect(bars[0].getAttribute("data-sign")).toBe("up");
    expect(bars[1].getAttribute("data-sign")).toBe("down");
    expect(bars[2].getAttribute("data-sign")).toBe("up");
    expect(bars[3].getAttribute("data-sign")).toBe("down");
    expect(bars[4].getAttribute("data-sign")).toBe("up");
  });
});

describe("IndexReturnsHistogram — magnitude scaling", () => {
  test("the larger absolute return produces a taller bar (per-card scaling)", () => {
    // +0.5% small green, +3% big green
    wrap(<IndexReturnsHistogram closes={[100, 100.5, 103.515]} height={22} />);
    const small = screen.getByTestId("histogram-bar-0");
    const big = screen.getByTestId("histogram-bar-1");
    const smallH = Number(small.getAttribute("height"));
    const bigH = Number(big.getAttribute("height"));
    expect(bigH).toBeGreaterThan(smallH);
  });

  test("the tallest bar in the card is bounded by the half-canvas budget", () => {
    // Two returns: +0.1% (flat) and +5% (huge). The +5% bar should fill the
    // upper half of the canvas without exceeding it.
    const height = 22;
    wrap(<IndexReturnsHistogram closes={[100, 100.1, 105.105]} height={height} />);
    const tall = screen.getByTestId("histogram-bar-1");
    const tallH = Number(tall.getAttribute("height"));
    expect(tallH).toBeGreaterThan(0);
    expect(tallH).toBeLessThanOrEqual(height / 2);
  });
});

describe("IndexReturnsHistogram — accessibility", () => {
  test("renders with a custom aria-label when provided", () => {
    wrap(
      <IndexReturnsHistogram
        closes={[100, 101]}
        ariaLabel="SPY 5-session daily returns histogram"
      />
    );
    expect(
      screen.getByRole("img", { name: "SPY 5-session daily returns histogram" })
    ).toBeInTheDocument();
  });

  test("default aria-label still surfaces the chart as a labelled image", () => {
    wrap(<IndexReturnsHistogram closes={[100, 101]} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      /5-session daily returns histogram/i
    );
  });

  test("each bar carries a <title> describing the session return", () => {
    wrap(<IndexReturnsHistogram closes={[100, 101]} />);
    const bar = screen.getByTestId("histogram-bar-0");
    const title = bar.querySelector("title");
    expect(title?.textContent || "").toMatch(/Session 1: \+1\.00%/);
  });
});

describe("IndexReturnsHistogram — anti-regression (line sparkline replaced)", () => {
  test("renders <rect> bars, not a <polyline> — the line sparkline was the predecessor", () => {
    const { container } = wrap(<IndexReturnsHistogram closes={[100, 101, 102]} />);
    const svg = container.querySelector('[data-testid="index-returns-histogram"]');
    expect(svg?.querySelector("polyline")).toBeNull();
    expect(svg?.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  test("does NOT mount under the old data-testid='index-sparkline'", () => {
    // Anti-regression so a future refactor doesn't accidentally rename the
    // bar viz back into the line-sparkline test surface.
    const { container } = wrap(<IndexReturnsHistogram closes={[100, 101]} />);
    expect(container.querySelector('[data-testid="index-sparkline"]')).toBeNull();
  });
});
