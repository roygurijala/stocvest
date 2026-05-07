import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { Sidebar } from "@/components/sidebar";
import { ThemeProvider } from "@/lib/theme-provider";

vi.mock("@/app/login/actions", () => ({
  logoutAction: vi.fn(async () => undefined)
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard"
}));

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

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("NAV_FEATURES sidebar", () => {
  test("test_nav_hides_options_when_flag_false", () => {
    wrap(<Sidebar userLabel="u@example.com" />);
    expect(screen.queryByText("Options")).not.toBeInTheDocument();
  });

  test("test_nav_hides_crypto_when_flag_false", () => {
    wrap(<Sidebar userLabel="u@example.com" />);
    expect(screen.queryByText("Crypto")).not.toBeInTheDocument();
  });

  test("test_nav_hides_futures_when_flag_false", () => {
    wrap(<Sidebar userLabel="u@example.com" />);
    expect(screen.queryByText("Futures")).not.toBeInTheDocument();
  });

  test("test_nav_shows_dashboard_always", () => {
    wrap(<Sidebar userLabel="u@example.com" />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });
});
