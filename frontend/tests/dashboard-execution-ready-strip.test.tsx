import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { DashboardExecutionReadyStrip } from "@/components/dashboard/dashboard-execution-ready-strip";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";

vi.mock("@/lib/theme-provider", () => ({
  useTheme: () => ({
    colors: {
      bullish: "#22c55e",
      border: "#334155",
      surface: "#0f172a",
      text: "#f8fafc",
      textMuted: "#94a3b8"
    }
  })
}));

vi.mock("@/lib/hooks/use-hover-prefetch", () => ({
  useHoverPrefetch: () => ({})
}));

vi.mock("@/components/info-tip", () => ({
  InfoTip: () => null
}));

afterEach(() => cleanup());

const scanSummary = {
  qualifying: { total: 2, swing: 2, day: 0, gap_flags: 0 }
} as ScannerScanSummary;

describe("<DashboardExecutionReadyStrip />", () => {
  test("renders pills when maturation and scanner counts are available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          mode: "swing",
          by_symbol: {
            AAPL: { state: "actionable", layers_aligned: 6, layers_total: 6, progress_band: "actionable" }
          }
        })
      })
    );

    render(
      <DashboardExecutionReadyStrip mode="swing" scanSummary={scanSummary} scannerPending={false} systemSuppressed={false} />
    );

    await waitFor(() => {
      expect(screen.getByTestId("dashboard-execution-ready-strip")).toBeTruthy();
    });
    expect(screen.getByTestId("dashboard-execution-ready-pill-watchlist").textContent).toContain("1 on your list");
    expect(screen.getByTestId("dashboard-execution-ready-pill-market").textContent).toContain("2 in market scan");
  });

  test("hides when counts are zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ mode: "swing", by_symbol: {} })
      })
    );

    render(
      <DashboardExecutionReadyStrip
        mode="swing"
        scanSummary={{ qualifying: { total: 0, swing: 0, day: 0, gap_flags: 0 } } as ScannerScanSummary}
        scannerPending={false}
        systemSuppressed={false}
      />
    );

    await waitFor(() => {
      expect(screen.queryByTestId("dashboard-execution-ready-strip")).toBeNull();
    });
  });
});
