import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/lib/theme-provider";
import type { AuthSession } from "@/lib/auth/types";

const session: AuthSession = { subject: "user-1", email: "test@example.com" };

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard/watchlists")
}));

vi.mock("@/lib/hooks/use-stacked-layout", () => ({
  useStackedLayout: () => true
}));

vi.mock("@/components/sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar-mock" />
}));

describe("AppShell page chrome", () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue("/dashboard/watchlists");
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }))
    );
  });

  test("renders page chrome with title on subpages", () => {
    render(
      <ThemeProvider>
        <AppShell session={session}>
          <div>child</div>
        </AppShell>
      </ThemeProvider>
    );

    expect(screen.getByTestId("dashboard-mobile-chrome")).toBeInTheDocument();
    expect(screen.getByText("Watchlist")).toBeInTheDocument();
  });

  test("omits page chrome on trading-room session routes", () => {
    vi.mocked(usePathname).mockReturnValue("/dashboard");

    render(
      <ThemeProvider>
        <AppShell session={session}>
          <div>child</div>
        </AppShell>
      </ThemeProvider>
    );

    expect(screen.queryByTestId("dashboard-mobile-chrome")).not.toBeInTheDocument();
  });
});
