import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeskModeTabNav } from "@/components/desk-mode-tab-nav";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("DeskModeTabNav", () => {
  it("renders swing and day with distinct test ids", () => {
    wrap(
      <DeskModeTabNav
        value="swing"
        onChange={() => undefined}
        modes={["swing", "day"]}
        ariaLabel="Desk"
        testIdPrefix="watchlist-desk"
      />
    );
    expect(screen.getByTestId("watchlist-desk-swing")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("watchlist-desk-day")).toHaveAttribute("aria-selected", "false");
  });
});
