import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";

import { ScannerScanResultHero } from "@/components/scanner/scanner-scan-result-hero";
import { ScannerQuietInsight } from "@/components/scanner/ScannerQuietInsight";
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

function emptySummary() {
  return buildScannerScanSummary({
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
}

describe("Scanner quiet header", () => {
  test("quiet compact merges status and desk rails in one hero", () => {
    const summary = emptySummary();
    wrap(
      <ScannerScanResultHero
        summary={summary}
        onRefresh={() => undefined}
        quietCompact
        marketScopeLine="Market-wide condition — low participation."
        nextScanLabel="4:36"
      />
    );
    expect(screen.getByTestId("scanner-quiet-ribbon")).toBeInTheDocument();
    expect(screen.getByTestId("scanner-scan-quiet-subline")).toHaveTextContent(/Market quiet/i);
    expect(screen.getByTestId("scanner-quiet-rail-gap")).toHaveTextContent("0");
    expect(screen.getByTestId("scanner-market-scope-inline")).toHaveTextContent(/Market-wide/i);
    expect(screen.getByTestId("scanner-next-scan")).toHaveTextContent(/4:36/);
    expect(screen.queryByTestId("scanner-scan-qualifying-total")).toBeNull();
  });
});

describe("ScannerQuietInsight", () => {
  test("wraps drill-down in a single details block", () => {
    wrap(
      <ScannerQuietInsight
        bullets={["Broad participation below intraday pace"]}
        closestGroups={[
          { label: "Volume constrained", items: [{ symbol: "AMZN", detail: "−8% vs expected" }] }
        ]}
      />
    );
    expect(screen.getByTestId("scanner-quiet-insight").tagName).toBe("DETAILS");
    expect(screen.getByText("Scan insight")).toBeInTheDocument();
  });
});
