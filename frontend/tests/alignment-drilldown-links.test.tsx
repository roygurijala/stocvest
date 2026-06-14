import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AlignmentDrilldownLinks } from "@/components/signals/alignment-drilldown-links";
import { ThemeProvider } from "@/lib/theme-provider";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

describe("AlignmentDrilldownLinks", () => {
  test("uses in-page handlers when provided", () => {
    const onEvidence = vi.fn();
    const onEvolution = vi.fn();
    render(
      <ThemeProvider>
        <AlignmentDrilldownLinks
          symbol="aapl"
          mode="swing"
          onOpenEvidence={onEvidence}
          onScrollToEvolution={onEvolution}
        />
      </ThemeProvider>
    );
    screen.getByTestId("alignment-drilldown-links-evidence").click();
    screen.getByTestId("alignment-drilldown-links-evolution").click();
    expect(onEvidence).toHaveBeenCalledTimes(1);
    expect(onEvolution).toHaveBeenCalledTimes(1);
  });

  test("links to trading room deep-dive and setup evolution hub", () => {
    render(
      <ThemeProvider>
        <AlignmentDrilldownLinks symbol="nvda" mode="day" />
      </ThemeProvider>
    );
    const evidenceHref = screen.getByTestId("alignment-drilldown-links-evidence").getAttribute("href");
    expect(evidenceHref).toContain("symbol=NVDA");
    expect(evidenceHref).toContain("lane=day");
    expect(evidenceHref).toContain("ref=setup-evolution");
    expect(screen.getByTestId("alignment-drilldown-links-evolution").getAttribute("href")).toContain(
      "/dashboard/setup-evolution"
    );
  });
});
