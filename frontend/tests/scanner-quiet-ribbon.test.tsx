import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { ScannerScanResultHero } from "@/components/scanner/scanner-scan-result-hero";
import { ScannerQuietInsight } from "@/components/scanner/ScannerQuietInsight";
import { ScannerCollapsible } from "@/components/scanner/ScannerCollapsible";
import { SCANNER_INSIGHT_SESSION_KEY } from "@/lib/scanner/scanner-disclosure-prefs";
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

beforeEach(() => {
  sessionStorage.clear();
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

describe("Scanner header", () => {
  test("quiet scan shows status rails and scope in unified header", () => {
    wrap(
      <ScannerScanResultHero
        summary={emptySummary()}
        onRefresh={() => undefined}
        marketScopeLine="Market-wide condition — low participation."
        nextScanLabel="4:36"
      />
    );
    expect(screen.getByTestId("scanner-quiet-ribbon")).toBeInTheDocument();
    expect(screen.getByTestId("scanner-scan-quiet-subline")).toHaveTextContent(/Market quiet/i);
    expect(screen.getByTestId("scanner-market-scope-inline")).toHaveTextContent(/Market-wide/i);
    expect(screen.getByTestId("scanner-next-scan")).toHaveTextContent(/4:36/);
  });

  test("active scan shows qualifying total and desk rails", () => {
    const summary = buildScannerScanSummary({
      scannedAtIso: "2026-05-16T14:30:00.000Z",
      overview: {
        setups: [
          {
            symbol: "AAPL",
            direction: "long",
            score: 0.7,
            triggers: ["x"],
            timestamp_iso: "x"
          }
        ],
        gapIntelligence: [],
        regimeLabel: "Neutral",
        spyPct: 0.1,
        qqqPct: 0.1,
        swingUniverseSymbolCount: 20,
        gapIntelligenceSnapshotSymbolCount: 20
      },
      nearQualificationSetups: [],
      watchlistProgression: []
    });
    wrap(<ScannerScanResultHero summary={summary} onRefresh={() => undefined} />);
    expect(screen.getByTestId("scanner-active-ribbon")).toBeInTheDocument();
    expect(screen.getByTestId("scanner-scan-qualifying-total")).toHaveTextContent(/1 qualifying setup/);
    expect(screen.getByTestId("scanner-quiet-rail-swing")).toBeInTheDocument();
  });
});

describe("ScannerCollapsible", () => {
  test("renders identifiable summary with chevron", () => {
    wrap(
      <ScannerCollapsible testId="test-collapsible" title="Scan insight" hint="3 near threshold">
        <p>Body</p>
      </ScannerCollapsible>
    );
    const el = screen.getByTestId("test-collapsible");
    expect(el.classList.contains("scanner-collapsible")).toBe(true);
    expect(screen.getByText("Scan insight")).toBeInTheDocument();
    expect(screen.getByText("3 near threshold")).toBeInTheDocument();
    expect(el.querySelector(".scanner-collapsible__chevron")).toBeTruthy();
  });

  test("persists open state in sessionStorage", () => {
    wrap(
      <ScannerCollapsible
        testId="persist-collapsible"
        title="Scan insight"
        persistSessionKey={SCANNER_INSIGHT_SESSION_KEY}
      >
        <p>Hidden body</p>
      </ScannerCollapsible>
    );
    const el = screen.getByTestId("persist-collapsible") as HTMLDetailsElement;
    expect(el.open).toBe(false);
    fireEvent.click(screen.getByText("Scan insight"));
    expect(el.open).toBe(true);
    expect(sessionStorage.getItem(SCANNER_INSIGHT_SESSION_KEY)).toBe("1");
  });
});

describe("ScannerQuietInsight", () => {
  test("uses ScannerCollapsible with session persistence", () => {
    wrap(
      <ScannerQuietInsight
        bullets={["Broad participation below intraday pace"]}
        closestGroups={[
          { label: "Volume constrained", items: [{ symbol: "AMZN", detail: "−8% vs expected" }] }
        ]}
      />
    );
    const el = screen.getByTestId("scanner-quiet-insight");
    expect(el.classList.contains("scanner-collapsible")).toBe(true);
    expect(screen.getByText(/near threshold/i)).toBeInTheDocument();
  });
});
