import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";

import { VolumeGapBar, VolumeGapBarList } from "@/components/scanner/VolumeGapBar";
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

describe("VolumeGapBar", () => {
  test("renders fill width from pct below (no visible % text)", () => {
    wrap(<VolumeGapBar symbol="SOFI" fillPct={88} pctBelow={12} />);
    expect(screen.getByText("SOFI")).toBeInTheDocument();
    expect(screen.queryByText(/−12%/)).toBeNull();
    expect(screen.getByTestId("scanner-volume-gap-SOFI-fill")).toHaveStyle({ width: "88%" });
  });
});

describe("VolumeGapBarList", () => {
  test("sorts closest-to-qualifying first and shows overflow", () => {
    wrap(
      <VolumeGapBarList
        rows={[
          { symbol: "A", pct_below: 80 },
          { symbol: "B", pct_below: 20 },
          { symbol: "C", pct_below: 50 },
          { symbol: "D", pct_below: 40 },
          { symbol: "E", pct_below: 30 },
          { symbol: "F", pct_below: 10 }
        ]}
        limit={5}
      />
    );
    expect(screen.getByTestId("scanner-volume-gap-B-fill")).toHaveStyle({ width: "80%" });
    expect(screen.getByText(/\+ 1 more/)).toBeInTheDocument();
  });
});
