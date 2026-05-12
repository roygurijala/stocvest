import type { ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { ScannerEmptyStateCard } from "@/components/scanner-empty-state-card";
import {
  buildDayEmptyStateContext,
  buildSwingEmptyStateContext
} from "@/lib/scanner-empty-state";
import { ThemeProvider } from "@/lib/theme-provider";

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

const baseInput = {
  regimeLabel: "Bearish",
  spyPct: -0.42,
  qqqPct: -0.31,
  swingUniverseSymbolCount: 240,
  sectorPct5d: [0.2, -0.1],
  marketStatus: { market: "open" } as { market: string }
};

describe("<ScannerEmptyStateCard /> — swing variant", () => {
  test("test_renders_swing_headline_and_oneliner", () => {
    const ctx = buildSwingEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} />);
    const card = screen.getByTestId("scanner-empty-state-swing");
    expect(card).toBeTruthy();
    expect(within(card).getByTestId("scanner-empty-state-swing-headline").textContent).toContain(
      "Swing Desk is quiet"
    );
  });

  test("test_swing_card_carries_pillLabel_SWING_MULTI_DAY", () => {
    const ctx = buildSwingEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} />);
    expect(screen.getByText(/SWING · MULTI-DAY/i)).toBeTruthy();
  });

  test("test_swing_card_renders_context_chips_for_universe_regime_tape", () => {
    const ctx = buildSwingEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} />);
    const strip = screen.getByTestId("scanner-empty-state-swing-context-strip");
    expect(strip.textContent).toContain("240 symbols scanned");
    expect(strip.textContent).toContain("Bearish");
    expect(strip.textContent).toContain("SPY");
    expect(strip.textContent).toContain("QQQ");
  });

  test("test_swing_card_reenable_bullets_render_under_disclosure", () => {
    const ctx = buildSwingEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} />);
    const reenable = screen.getByTestId("scanner-empty-state-swing-reenable");
    const bullets = reenable.querySelectorAll("li");
    expect(bullets.length).toBeGreaterThanOrEqual(3);
  });

  test("test_swing_card_renders_crosslinks_in_full_width_mode", () => {
    const ctx = buildSwingEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} />);
    const nav = screen.getByTestId("scanner-empty-state-swing-crosslinks");
    expect(within(nav).getByText("Browse signal validation")).toBeTruthy();
    expect(within(nav).getByText("Edit your watchlist")).toBeTruthy();
    expect(within(nav).getByText("Back to dashboard")).toBeTruthy();
  });

  test("test_swing_card_compact_mode_drops_crosslinks", () => {
    const ctx = buildSwingEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} compact />);
    expect(screen.queryByTestId("scanner-empty-state-swing-crosslinks")).toBeNull();
  });

  test("test_swing_card_carries_data_mode_swing_for_role_styling", () => {
    const ctx = buildSwingEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} />);
    expect(screen.getByTestId("scanner-empty-state-swing").getAttribute("data-mode")).toBe("swing");
  });
});

describe("<ScannerEmptyStateCard /> — day variant", () => {
  test("test_renders_day_headline_when_session_open", () => {
    const ctx = buildDayEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} />);
    expect(
      screen.getByTestId("scanner-empty-state-day-headline").textContent
    ).toContain("Day Desk is quiet");
  });

  test("test_renders_day_headline_when_session_closed", () => {
    const ctx = buildDayEmptyStateContext({
      ...baseInput,
      marketStatus: { market: "closed" }
    });
    wrap(<ScannerEmptyStateCard context={ctx} />);
    expect(
      screen.getByTestId("scanner-empty-state-day-headline").textContent
    ).toContain("suppressed");
  });

  test("test_day_card_carries_pillLabel_DAY_INTRADAY", () => {
    const ctx = buildDayEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} />);
    expect(screen.getByText(/DAY · INTRADAY/i)).toBeTruthy();
  });

  test("test_day_card_carries_data_mode_day_for_role_styling", () => {
    const ctx = buildDayEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} />);
    expect(screen.getByTestId("scanner-empty-state-day").getAttribute("data-mode")).toBe("day");
  });
});

describe("<ScannerEmptyStateCard /> — never leaks cross-mode vocabulary", () => {
  test("test_swing_card_renders_no_day_vocabulary_in_visible_text", () => {
    const ctx = buildSwingEmptyStateContext(baseInput);
    wrap(<ScannerEmptyStateCard context={ctx} />);
    const card = screen.getByTestId("scanner-empty-state-swing");
    const text = card.textContent?.toLowerCase() ?? "";
    expect(text).not.toContain("intraday confirmation");
    expect(text).not.toContain("vwap-aligned");
    expect(text).not.toContain("orb qualification");
  });

  test("test_day_card_renders_no_swing_vocabulary_in_visible_text", () => {
    const ctx = buildDayEmptyStateContext({ ...baseInput, regimeLabel: "Neutral" });
    wrap(<ScannerEmptyStateCard context={ctx} />);
    const card = screen.getByTestId("scanner-empty-state-day");
    const text = card.textContent?.toLowerCase() ?? "";
    expect(text).not.toContain("regime alignment");
    expect(text).not.toContain("multi-day structure");
    expect(text).not.toContain("dailybarscanner");
  });

  test("test_card_renders_no_recommendation_words", () => {
    const swing = buildSwingEmptyStateContext(baseInput);
    const day = buildDayEmptyStateContext(baseInput);
    wrap(
      <>
        <ScannerEmptyStateCard context={swing} testId="emp-swing" />
        <ScannerEmptyStateCard context={day} testId="emp-day" />
      </>
    );
    const allText = `${screen.getByTestId("emp-swing").textContent ?? ""} ${
      screen.getByTestId("emp-day").textContent ?? ""
    }`.toLowerCase();
    for (const banned of ["approve", "recommend", "validated", "qualified to trade", "endorsed"]) {
      expect(allText).not.toContain(banned);
    }
  });
});
