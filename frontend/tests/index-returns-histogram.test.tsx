/**
 * Lock-in tests for the SPY/QQQ/IWM daily-returns histogram (horizontal layout
 * inside Shared Context · Section A).
 *
 * Invariants worth pinning:
 *   • Bar count = closes.length − 1 (one bar per *daily return*, not per close).
 *   • Polarity:
 *       - Bar `data-sign` = "up" / "down" / "flat" with the same neutral band
 *         as the % label (±0.1%).
 *       - Positive bars extend RIGHT from the vertical zero line; negative
 *         bars extend LEFT toward the line. Position carries the signal for
 *         colorblind users even if color is suppressed.
 *   • Color: matches `getChangeColor` (bullish / bearish / muted) — we only
 *     assert up vs down differ, not literal hex.
 *   • Magnitude: per-card scaling — larger |return| → longer bar (width).
 *   • Empty / degenerate input: same rules as the legacy vertical chart.
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
    wrap(
      <IndexReturnsHistogram
        closes={[100, NaN, 102, 0, 104, -5 as number]}
      />
    );
    const bars = screen.getAllByTestId(/^histogram-bar-\d+$/);
    expect(bars).toHaveLength(2);
  });

  test("the zero-line is vertical (horizontal histogram)", () => {
    wrap(<IndexReturnsHistogram closes={[100, 101, 102]} />);
    const svg = screen.getByTestId("index-returns-histogram");
    expect(svg.getAttribute("data-orientation")).toBe("horizontal");
    const zeroLine = screen.getByTestId("histogram-zero-line");
    const x1 = Number(zeroLine.getAttribute("x1"));
    const x2 = Number(zeroLine.getAttribute("x2"));
    expect(x1).toBe(x2);
    const y1 = Number(zeroLine.getAttribute("y1"));
    const y2 = Number(zeroLine.getAttribute("y2"));
    expect(Math.abs(y2 - y1)).toBeGreaterThan(1);
  });
});

describe("IndexReturnsHistogram — polarity (color + position)", () => {
  test("positive return → sign=up, fill matches bullish token", () => {
    wrap(<IndexReturnsHistogram closes={[100, 101]} />);
    const bar = screen.getByTestId("histogram-bar-0");
    expect(bar.getAttribute("data-sign")).toBe("up");
    const fill = (bar.getAttribute("fill") || "").toLowerCase();
    expect(fill).not.toBe("");
    wrap(<IndexReturnsHistogram closes={[100, 99]} />);
    const downBar = screen.getAllByTestId("histogram-bar-0").at(-1)!;
    expect(downBar.getAttribute("data-sign")).toBe("down");
    const downFill = (downBar.getAttribute("fill") || "").toLowerCase();
    expect(downFill).not.toBe(fill);
  });

  test("negative return → sign=down and the bar ends at the vertical zero line", () => {
    wrap(<IndexReturnsHistogram closes={[100, 99]} />);
    const bar = screen.getByTestId("histogram-bar-0");
    expect(bar.getAttribute("data-sign")).toBe("down");
    const zeroLine = screen.getByTestId("histogram-zero-line");
    const centerX = Number(zeroLine.getAttribute("x1"));
    const bx = Number(bar.getAttribute("x"));
    const bw = Number(bar.getAttribute("width"));
    expect(bx + bw).toBeCloseTo(centerX, 1);
  });

  test("positive return → bar starts at the vertical zero line and extends right", () => {
    wrap(<IndexReturnsHistogram closes={[100, 101]} />);
    const bar = screen.getByTestId("histogram-bar-0");
    const zeroLine = screen.getByTestId("histogram-zero-line");
    const centerX = Number(zeroLine.getAttribute("x1"));
    const bx = Number(bar.getAttribute("x"));
    expect(bx).toBeCloseTo(centerX, 1);
  });

  test("near-flat return (|Δ| ≤ 0.1%) → sign=flat with a visible stub on the zero line", () => {
    wrap(<IndexReturnsHistogram closes={[100, 100.05]} />);
    const bar = screen.getByTestId("histogram-bar-0");
    expect(bar.getAttribute("data-sign")).toBe("flat");
    expect(Number(bar.getAttribute("width"))).toBeGreaterThanOrEqual(1);
  });

  test("five-bar mixed week renders each bar with the correct polarity", () => {
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
  test("the larger absolute return produces a longer bar (per-card scaling)", () => {
    wrap(<IndexReturnsHistogram closes={[100, 100.5, 103.515]} />);
    const small = screen.getByTestId("histogram-bar-0");
    const big = screen.getByTestId("histogram-bar-1");
    const smallW = Number(small.getAttribute("width"));
    const bigW = Number(big.getAttribute("width"));
    expect(bigW).toBeGreaterThan(smallW);
  });

  test("the longest single-sided bar does not cross the full half-viewport", () => {
    wrap(<IndexReturnsHistogram closes={[100, 100.1, 105.105]} />);
    const longBar = screen.getByTestId("histogram-bar-1");
    const w = Number(longBar.getAttribute("width"));
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(50);
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
    expect(title?.textContent || "").toMatch(/Daily return \(close-to-close, only session in window\): \+1\.00%/);
  });

  test("tags oldest, middle, and most-recent rows in a five-return window", () => {
    wrap(<IndexReturnsHistogram closes={[100, 101, 102, 103, 104, 105]} />);
    expect(screen.getByTestId("histogram-bar-0").getAttribute("data-session-order")).toBe("oldest");
    expect(screen.getByTestId("histogram-bar-1").getAttribute("data-session-order")).toBe("middle");
    expect(screen.getByTestId("histogram-bar-4").getAttribute("data-session-order")).toBe("most-recent");
    expect(screen.getByTestId("histogram-bar-4").getAttribute("data-most-recent")).toBe("true");
    expect(screen.getByTestId("histogram-bar-0").getAttribute("data-most-recent")).toBe("false");
  });

  test("multi-day first bar title names the oldest session", () => {
    wrap(<IndexReturnsHistogram closes={[100, 101, 102]} />);
    const oldest = screen.getByTestId("histogram-bar-0").querySelector("title");
    const newest = screen.getByTestId("histogram-bar-1").querySelector("title");
    expect(oldest?.textContent || "").toMatch(/Oldest session:/);
    expect(newest?.textContent || "").toMatch(/Most recent session:/);
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
    const { container } = wrap(<IndexReturnsHistogram closes={[100, 101]} />);
    expect(container.querySelector('[data-testid="index-sparkline"]')).toBeNull();
  });
});
