import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { ScannerEvaluationTraceSection } from "@/components/scanner/scanner-evaluation-trace-section";
import { parseScannerSetupsDeskResponse } from "@/lib/scanner-setups-response";
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

describe("scanner evaluation trace", () => {
  test("parseScannerSetupsDeskResponse reads evaluation_trace", () => {
    const parsed = parseScannerSetupsDeskResponse({
      qualifying: [],
      near_qualification: [],
      evaluation_trace: [
        {
          symbol: "nvda",
          desk: "day",
          gate: "session_rvol",
          detail: "Session volume 18% below expected intraday pace",
          outcome: "did_not_qualify",
          margin_pct: 18
        }
      ]
    });
    expect(parsed.evaluationTrace).toHaveLength(1);
    expect(parsed.evaluationTrace[0]?.symbol).toBe("NVDA");
  });

  test("section uses safe framing and expands on toggle", () => {
    wrap(
      <ScannerEvaluationTraceSection
        rows={[
          {
            symbol: "NVDA",
            desk: "day",
            gate: "session_rvol",
            detail: "Session volume 18% below expected intraday pace",
            outcome: "did_not_qualify",
            margin_pct: 18
          }
        ]}
      />
    );
    const section = screen.getByTestId("scanner-evaluation-trace");
    expect(section.textContent).toContain("did not qualify");
    expect(section.textContent).toContain("not a watchlist");
    expect(section.textContent).not.toMatch(/near miss/i);
    expect(section.textContent).not.toMatch(/watch closely/i);
    expect(screen.queryByTestId("scanner-evaluation-trace-list")).toBeNull();
    fireEvent.click(screen.getByTestId("scanner-evaluation-trace-toggle"));
    expect(screen.getByTestId("scanner-evaluation-trace-list").textContent).toContain("NVDA");
  });
});
