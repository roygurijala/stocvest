import { describe, expect, test } from "vitest";
import {
  buildExecutionReadyCounts,
  buildExecutionReadyPills,
  countWatchlistExecutionReady,
  executionReadyStripVisible,
  executionReadyWatchlistHref
} from "@/lib/dashboard/execution-ready-strip-present";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";

const scanSummary = {
  qualifying: { total: 3, swing: 2, day: 1, gap_flags: 0 }
} as ScannerScanSummary;

describe("execution-ready-strip-present", () => {
  test("counts watchlist actionable maturation rows", () => {
    const n = countWatchlistExecutionReady({
      AAPL: { state: "actionable", layers_aligned: 6, layers_total: 6 },
      MSFT: { state: "developing", layers_aligned: 3, layers_total: 6 }
    });
    expect(n).toBe(1);
  });

  test("buildExecutionReadyCounts splits watchlist and market", () => {
    expect(
      buildExecutionReadyCounts({
        bySymbol: { AAPL: { state: "actionable", layers_aligned: 5, layers_total: 6 } },
        scanSummary,
        mode: "swing"
      })
    ).toEqual({ watchlist: 1, marketScan: 2 });
  });

  test("buildExecutionReadyPills only includes non-zero counts", () => {
    const pills = buildExecutionReadyPills({
      counts: { watchlist: 1, marketScan: 0 },
      mode: "swing",
      deskLabel: "Swing"
    });
    expect(pills).toHaveLength(1);
    expect(pills[0]?.id).toBe("watchlist");
    expect(pills[0]?.href).toBe(executionReadyWatchlistHref("swing"));
  });

  test("executionReadyStripVisible hides when suppressed or empty", () => {
    expect(
      executionReadyStripVisible({
        counts: { watchlist: 1, marketScan: 0 },
        loading: false,
        systemSuppressed: true
      })
    ).toBe(false);
    expect(
      executionReadyStripVisible({
        counts: { watchlist: 0, marketScan: 0 },
        loading: false,
        systemSuppressed: false
      })
    ).toBe(false);
  });
});
