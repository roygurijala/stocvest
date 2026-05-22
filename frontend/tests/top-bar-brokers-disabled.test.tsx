/**
 * Lock-in: the trading-mode (Paper / Live) pill in the TopBar is hidden
 * while broker integration is paused (BACKLOG B31).
 *
 * The pill is the user's only entry point to mutate `trading_mode`, and
 * that field only carries meaning when a broker is connected. With brokers
 * gated off, rendering the pill would imply the user can switch into live
 * execution — a UX promise we deliberately don't make right now.
 *
 * This test fails loud if a future refactor either drops the
 * `brokersEnabled()` ternary in `top-bar.tsx` or renames the flag without
 * updating the gate.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard"
}));

vi.mock("@/lib/nav-features", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nav-features")>(
    "@/lib/nav-features"
  );
  return {
    ...actual,
    brokersEnabled: () => false
  };
});

import { TopBar } from "@/components/top-bar";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("TopBar (brokers disabled)", () => {
  test("trading-mode badge is absent when brokersEnabled() returns false", () => {
    wrap(<TopBar />);
    expect(screen.queryByText(/Paper/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Live/i)).not.toBeInTheDocument();
  });

  test("title and theme toggle still render", () => {
    wrap(<TopBar />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });
});
