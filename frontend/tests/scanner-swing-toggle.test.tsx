import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { ScannerPageClient } from "@/components/scanner-page-client";
import { ThemeProvider } from "@/lib/theme-provider";

vi.mock("@/lib/hooks/use-is-mobile-layout", () => ({
  useIsMobileLayout: () => false
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

const SCANNER_MODE_STORAGE_KEY = "stocvest_scanner_mode";

const { loadScannerDataWithoutBriefMock } = vi.hoisted(() => ({
  loadScannerDataWithoutBriefMock: vi.fn(async () => ({
    gapIntelligence: [] as import("@/lib/api/scanner").GapIntelligenceItem[],
    setups: [] as import("@/lib/api/scanner").IntradaySetupPayload[],
    spyPct: null as number | null,
    qqqPct: null as number | null,
    regimeLabel: "Neutral"
  }))
}));

vi.mock("@/lib/api/scanner-client-load", () => ({
  loadScannerDataWithoutBrief: loadScannerDataWithoutBriefMock
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn()
  })
}));

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("ScannerPageClient setup mode toggle", () => {
  beforeEach(() => {
    loadScannerDataWithoutBriefMock.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test("test_scanner_mode_toggle_default_swing", async () => {
    wrap(
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
      />
    );
    const swing = screen.getByRole("tab", { name: "Swing" });
    await waitFor(() => expect(swing).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "false");
  });

  test("test_scanner_mode_persisted_in_localstorage", async () => {
    const ui = (
      <ScannerPageClient
        initialOverview={{ gapIntelligence: [], setups: [] }}
        initialTimestampIso="2026-05-06T12:00:00.000Z"
        earningsBySymbol={{}}
      />
    );
    const r1 = wrap(ui);
    fireEvent.click(screen.getByRole("tab", { name: "Day" }));
    await waitFor(() => expect(localStorage.getItem(SCANNER_MODE_STORAGE_KEY)).toBe("day"));
    r1.unmount();

    wrap(ui);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true"));
  });
});
