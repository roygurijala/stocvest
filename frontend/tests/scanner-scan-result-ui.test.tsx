import type { ReactElement } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { ScannerNearQualificationSection } from "@/components/scanner/scanner-near-qualification-section";
import { ScannerScanResultHero } from "@/components/scanner/scanner-scan-result-hero";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { buildScannerScanSummary } from "@/lib/scanner-scan-summary";
import type { ScannerScanSummary } from "@/lib/scanner-scan-summary";
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

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  });
});

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function baseOverview(overrides?: {
  setups?: IntradaySetupPayload[];
  watchlistStatus?: ScannerScanSummary["watchlist"];
}) {
  return {
    setups: overrides?.setups ?? [],
    gapIntelligence: [],
    regimeLabel: "Neutral",
    spyPct: 0.12,
    qqqPct: -0.08,
    swingUniverseSymbolCount: 240,
    gapIntelligenceSnapshotSymbolCount: 412,
    watchlistStatus:
      overrides?.watchlistStatus ??
      ({ monitored: 8, actionable: 1, developing: 2, inactive: 5 } as const)
  };
}

function buildSummary(input?: {
  setups?: IntradaySetupPayload[];
  near?: IntradaySetupPayload[];
  progression?: ScannerScanSummary["watchlist_progression"];
  watchlistStatus?: ScannerScanSummary["watchlist"];
}): ScannerScanSummary {
  return buildScannerScanSummary({
    scannedAtIso: "2026-05-16T14:30:00.000Z",
    overview: baseOverview({
      setups: input?.setups,
      watchlistStatus: input?.watchlistStatus
    }),
    nearQualificationSetups: input?.near ?? [],
    watchlistProgression: input?.progression ?? []
  });
}

const NEAR_AMD: IntradaySetupPayload = {
  symbol: "AMD",
  direction: "long",
  score: 0.42,
  triggers: ["vwap_reclaim", "orb_breakout_long"],
  timestamp_iso: "2026-05-16T14:00:00Z"
};

describe("<ScannerScanResultHero />", () => {
  test("renders qualifying total and desk breakdown", () => {
    const summary = buildSummary({
      setups: [
        {
          symbol: "AAPL",
          direction: "long",
          score: 0.62,
          triggers: [],
          timestamp_iso: "x"
        }
      ]
    });
    wrap(<ScannerScanResultHero summary={summary} onRefresh={vi.fn()} />);
    const hero = screen.getByTestId("scanner-scan-result-hero");
    expect(within(hero).getByTestId("scanner-scan-qualifying-total").textContent).toContain(
      "1 qualifying setup"
    );
    expect(within(hero).getByTestId("scanner-scan-desk-breakdown").textContent).toContain("Swing 0");
    expect(within(hero).getByTestId("scanner-scan-desk-breakdown").textContent).toContain("Day 1");
  });

  test("shows near-qualification next action when near rows exist", () => {
    const summary = buildSummary({ near: [NEAR_AMD] });
    wrap(<ScannerScanResultHero summary={summary} onRefresh={vi.fn()} />);
    const link = screen.getByTestId("scanner-next-action-near");
    expect(link.getAttribute("href")).toBe("#scanner-near-qualification");
    expect(link.textContent).toContain("approaching threshold");
  });

  test("shows why-nothing-passed action when qualifying is zero", () => {
    const summary = buildSummary();
    wrap(<ScannerScanResultHero summary={summary} onRefresh={vi.fn()} />);
    expect(screen.getByTestId("scanner-next-action-why").getAttribute("href")).toBe(
      "#scanner-scan-education"
    );
    expect(screen.queryByTestId("scanner-next-action-qualifying")).toBeNull();
  });

  test("watchlist insight row when status present", () => {
    const summary = buildSummary();
    wrap(<ScannerScanResultHero summary={summary} onRefresh={vi.fn()} />);
    const row = screen.getByTestId("scanner-watchlist-insight");
    expect(row.textContent).toContain("8 monitored");
    expect(row.textContent).toContain("1 actionable");
  });

  test("watchlist progress note when nothing qualifies and developing", () => {
    const summary = buildSummary({
      watchlistStatus: { monitored: 6, actionable: 0, developing: 2, inactive: 4 }
    });
    wrap(<ScannerScanResultHero summary={summary} onRefresh={vi.fn()} />);
    expect(screen.getByTestId("scanner-watchlist-progress-note")).toHaveTextContent(
      /Nothing actionable yet/i
    );
  });

  test("refresh button calls onRefresh", () => {
    const onRefresh = vi.fn();
    wrap(<ScannerScanResultHero summary={buildSummary()} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTestId("scanner-hero-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("<ScannerNearQualificationSection />", () => {
  test("returns null when both lanes empty", () => {
    const { container } = wrap(
      <ScannerNearQualificationSection nearQualification={[]} watchlistProgression={[]} />
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders near rows with non-actionable framing copy", () => {
    const summary = buildSummary({ near: [NEAR_AMD] });
    wrap(
      <ScannerNearQualificationSection
        nearQualification={summary.near_qualification}
        watchlistProgression={[]}
      />
    );
    const section = screen.getByTestId("scanner-near-qualification");
    expect(section.textContent).toContain("Approaching threshold");
    expect(section.textContent).toContain("not actionable entries");
    expect(section.textContent).toContain("AMD");
    expect(section.textContent).toContain("2/6");
    expect(section.textContent).toContain("layer");
    const signalsLink = within(section).getByText("Open Signals →");
    expect(signalsLink.getAttribute("href")).toContain("symbol=AMD");
    expect(signalsLink.getAttribute("href")).toContain("trading_mode=day");
  });

  test("renders watchlist progression lane separately from near qualification", () => {
    wrap(
      <ScannerNearQualificationSection
        nearQualification={[]}
        watchlistProgression={[
          { symbol: "MSFT", desk: "swing", state: "developing", label: "Developing" }
        ]}
      />
    );
    expect(screen.queryByText("Approaching threshold")).toBeNull();
    const lane = screen.getByTestId("scanner-watchlist-progression");
    expect(lane.textContent).toContain("Watchlist progression");
    expect(lane.textContent).toContain("MSFT");
    expect(within(lane).getByText("Watchlist →").getAttribute("href")).toContain("focus=MSFT");
  });

  test("avoids implicit-recommendation phrasing in near lane copy", () => {
    const summary = buildSummary({ near: [NEAR_AMD] });
    wrap(
      <ScannerNearQualificationSection
        nearQualification={summary.near_qualification}
        watchlistProgression={[]}
      />
    );
    const text = screen.getByTestId("scanner-near-qualification").textContent ?? "";
    expect(text).not.toMatch(/near miss/i);
    expect(text).not.toMatch(/watch closely/i);
    expect(text).not.toMatch(/almost made it/i);
    expect(text).not.toMatch(/\bconsider\b/i);
  });
});
