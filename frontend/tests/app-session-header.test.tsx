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
    const marketFull = document.querySelector(".session-header-market-full");
    expect(marketFull).not.toBeNull();
    expect(marketFull).toHaveTextContent(/Market in/);
    expect(marketFull).toHaveTextContent("Bearish");
    expect(screen.getByText("2", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/actionable/)).toBeInTheDocument();
  });
});
