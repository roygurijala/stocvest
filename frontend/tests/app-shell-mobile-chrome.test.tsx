import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/lib/theme-provider";
import type { AuthSession } from "@/lib/auth/types";

const session: AuthSession = { subject: "user-1", email: "test@example.com" };

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/watchlists"
}));

vi.mock("@/lib/hooks/use-stacked-layout", () => ({
  useStackedLayout: () => true
}));

vi.mock("@/components/sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar-mock" />
}));

describe("AppShell mobile chrome", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    );
  });

  test("renders dashboard mobile chrome instead of legacy top bar on compact nav", () => {
    render(
      <ThemeProvider>
        <AppShell session={session}>
          <div>child</div>
        </AppShell>
      </ThemeProvider>
    );

    expect(screen.getByTestId("dashboard-mobile-chrome")).toBeInTheDocument();
    expect(screen.queryByTestId("app-top-bar")).not.toBeInTheDocument();
    expect(screen.getByText("Watchlist")).toBeInTheDocument();
  });
});
