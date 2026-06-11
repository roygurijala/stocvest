import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AppSessionHeader } from "@/components/app-session-header";
import { colorTokens, spacing } from "@/lib/design-system";
import { AppChromeProvider } from "@/lib/app-chrome-context";
import { ThemeProvider } from "@/lib/theme-provider";

vi.mock("@/components/dashboard/trading-room/symbol-search", () => ({
  SymbolSearch: () => <input data-testid="symbol-search-mock" />
}));
vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>
}));
vi.mock("@/lib/hooks/use-stacked-layout", () => ({
  useStackedLayout: () => false
}));

describe("<AppSessionHeader />", () => {
  test("renders pulse line and actionable chip", () => {
    render(
      <ThemeProvider>
        <AppChromeProvider value={{ openNavDrawer: () => {} }}>
          <AppSessionHeader
          regimeLabel="Bearish"
          spyPct={-0.4}
          qqqPct={-0.6}
          iwmPct={-0.2}
          vixLevel={21.5}
          marketStatusLabel="Market open"
          marketOpen
          counts={{ actionable: 2, near: 1, potential: 0, cooling: 0 }}
          updatedAtIso="2026-06-08T14:30:00.000Z"
          onOpenSymbol={() => {}}
          bleed={spacing[4]}
          colors={colorTokens.dark}
          />
        </AppChromeProvider>
      </ThemeProvider>
    );

    expect(screen.getByTestId("app-session-header")).toBeInTheDocument();
    expect(screen.getByText(/Market in/)).toBeInTheDocument();
    expect(screen.getByText("Bearish")).toBeInTheDocument();
    expect(screen.getByText("2", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/actionable/)).toBeInTheDocument();
  });
});
