import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { MobileNavDrawer } from "@/components/mobile-nav-drawer";
import { ThemeProvider } from "@/lib/theme-provider";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/setup-outcomes"
}));

vi.mock("@/lib/hooks/use-body-scroll-lock", () => ({
  useBodyScrollLock: vi.fn()
}));

vi.mock("@/lib/nav-features", () => ({
  isDashboardNavItemEnabled: () => true
}));

describe("MobileNavDrawer", () => {
  test("renders sectioned navigation matching the desktop sidebar", () => {
    render(
      <ThemeProvider>
        <MobileNavDrawer open onClose={vi.fn()} userLabel="test@example.com" isAdmin={false} />
      </ThemeProvider>
    );

    expect(screen.getByRole("dialog", { name: "Main navigation" })).toBeInTheDocument();
    expect(screen.getByText("Trading")).toBeInTheDocument();
    expect(screen.getByText("Analysis")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dashboard/i })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /Setup outcomes/i })).toHaveAttribute(
      "href",
      "/dashboard/setup-outcomes"
    );
    expect(screen.queryByRole("link", { name: /^Signals$/i })).not.toBeInTheDocument();
  });

  test("opens admin section when isAdmin", () => {
    render(
      <ThemeProvider>
        <MobileNavDrawer open onClose={vi.fn()} userLabel="admin@example.com" isAdmin />
      </ThemeProvider>
    );

    expect(screen.getByTestId("mobile-nav-admin-section")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mobile-nav-admin-toggle"));
    expect(screen.getByTestId("mobile-nav-admin-item-/dashboard/admin")).toBeInTheDocument();
  });
});
