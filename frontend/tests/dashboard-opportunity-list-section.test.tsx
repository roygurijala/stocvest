import { describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DashboardOpportunityListSection } from "@/components/dashboard/dashboard-opportunity-list-section";
import type { OpportunityRowModel } from "@/lib/dashboard/opportunity-row-present";
import { ThemeProvider } from "@/lib/theme-provider";

function row(symbol: string): OpportunityRowModel {
  return {
    symbol,
    rank: 1,
    layerDots: [true, true, true, true, true, true],
    layerTotal: 6,
    primaryLine: "Strong alignment · R/R 1.6:1 below gate",
    rrLine: "R/R 1.6:1",
    detailLine: "closest to threshold",
    gapLine: "▲ +0.5% today",
    gapTone: "bullish",
    badgeLabel: "R/R blocks entry",
    sourceLabel: "Quiet",
    href: `/dashboard/signals?symbol=${symbol}`,
    peek: "peek"
  };
}

describe("DashboardOpportunityListSection", () => {
  test("previewCount hides extra rows until expand", () => {
    render(
      <ThemeProvider>
        <DashboardOpportunityListSection
          rows={["A", "B", "C", "D", "E"].map(row)}
          testId="test-list"
          previewCount={4}
          expandTestId="test-expand"
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("dashboard-opportunity-row-A")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-opportunity-row-E")).toBeNull();
    fireEvent.click(screen.getByTestId("test-expand"));
    expect(screen.getByTestId("dashboard-opportunity-row-E")).toBeInTheDocument();
  });

  test("collapseAllUntilExpand hides list until expand", () => {
    render(
      <ThemeProvider>
        <DashboardOpportunityListSection
          rows={[row("ASTC")]}
          testId="closed-list"
          collapseAllUntilExpand
          expandTestId="closed-expand"
        />
      </ThemeProvider>
    );
    expect(screen.queryByTestId("dashboard-opportunity-row-ASTC")).toBeNull();
    fireEvent.click(screen.getByTestId("closed-expand"));
    expect(screen.getByTestId("dashboard-opportunity-row-ASTC")).toBeInTheDocument();
  });
});
