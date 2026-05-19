import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";

import { ScannerQuietRibbon } from "@/components/scanner/ScannerQuietRibbon";
import { ScannerCauseSection } from "@/components/scanner/ScannerCauseSection";
import { buildScannerScanSummary } from "@/lib/scanner-scan-summary";
import { ThemeProvider } from "@/lib/theme-provider";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    })
  });
});

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("ScannerQuietRibbon", () => {
  test("renders status and color-rail desk counts", () => {
    const summary = buildScannerScanSummary({
      scannedAtIso: "2026-05-16T14:30:00.000Z",
      overview: {
        setups: [],
        gapIntelligence: [],
        regimeLabel: "Bearish",
        spyPct: -0.1,
        qqqPct: -0.08,
        swingUniverseSymbolCount: 20,
        gapIntelligenceSnapshotSymbolCount: 20
      },
      nearQualificationSetups: [],
      watchlistProgression: []
    });
    wrap(<ScannerQuietRibbon summary={summary} />);
    expect(screen.getByTestId("scanner-quiet-ribbon")).toBeInTheDocument();
    expect(screen.getByTestId("scanner-scan-quiet-subline")).toHaveTextContent(/Market quiet/i);
    expect(screen.getByTestId("scanner-quiet-rail-gap")).toHaveTextContent("0");
    expect(screen.getByTestId("scanner-quiet-rail-swing")).toHaveTextContent("0");
    expect(screen.getByTestId("scanner-quiet-rail-day")).toHaveTextContent("0");
  });
});

describe("ScannerCauseSection collapsible", () => {
  test("wraps bullets in details when collapsible", () => {
    wrap(
      <ScannerCauseSection
        collapsible
        bullets={["Broad participation below intraday pace", "Index leaders not confirming"]}
        marketScopeLine="Market-wide condition — low participation."
      />
    );
    const details = screen.getByTestId("scanner-cause-section");
    expect(details.tagName).toBe("DETAILS");
    expect(screen.getByText("Why nothing passed")).toBeInTheDocument();
    expect(screen.queryByText(/Broad participation/)).not.toBeVisible();
  });
});
