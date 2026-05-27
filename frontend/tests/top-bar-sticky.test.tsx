/**
 * Lock-in: the dashboard TopBar stays pinned to the viewport while the
 * document (``body``) scrolls.
 *
 *   1. ``TopBar`` uses ``position: fixed`` + sidebar offset on ``lg+``.
 *   2. ``AppShell`` does not trap scroll in a nested ``overflow`` container.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn(), replace: vi.fn() })
}));

import { AppShell } from "@/components/app-shell";
import { TopBar } from "@/components/top-bar";
import { ThemeProvider } from "@/lib/theme-provider";
import type { AuthSession } from "@/lib/auth/types";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const SESSION: AuthSession = {
  subject: "user-sub-test",
  email: "tester@example.com",
  cognitoGroups: [],
  isAdmin: false
} as unknown as AuthSession;

describe("TopBar viewport pinning", () => {
  test("header carries the fixed-position classes that pin it during scroll", () => {
    wrap(<TopBar />);
    const header = screen.getByTestId("app-top-bar");
    const cls = header.className;
    expect(cls).toMatch(/(^|\s)fixed(\s|$)/);
    expect(cls).toMatch(/(^|\s)top-0(\s|$)/);
    expect(cls).toMatch(/(^|\s)left-0(\s|$)/);
    expect(cls).toMatch(/(^|\s)z-30(\s|$)/);
    expect(cls).toMatch(/lg:left-\[248px\]/);
  });
});

describe("AppShell layout (document scroll on body)", () => {
  test("right column is not a viewport-height scroll trap", () => {
    wrap(
      <AppShell session={SESSION} isAdmin={false}>
        <p>Page content</p>
      </AppShell>
    );
    const rightCol = screen.getByTestId("app-shell-right-column");
    expect(rightCol.className).not.toMatch(/h-\[100dvh\]/);
    expect(rightCol.className).not.toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(rightCol.className).not.toMatch(/(^|\s)overflow-hidden(\s|$)/);
  });

  test("<main> does not create a nested scroll container", () => {
    wrap(
      <AppShell session={SESSION} isAdmin={false}>
        <p data-testid="page-marker">Page content</p>
      </AppShell>
    );
    const main = screen.getByTestId("page-marker").closest("main");
    expect(main).not.toBeNull();
    expect(main!.className).not.toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(main!.className).not.toMatch(/(^|\s)overflow-hidden(\s|$)/);
  });

  test("watchlist-flush main uses top-bar clearance only (no extra spacing[6] gap)", () => {
    wrap(
      <AppShell session={SESSION} isAdmin={false} mainTopLayout="watchlist-flush">
        <p data-testid="watchlist-page-marker">Watchlist</p>
      </AppShell>
    );
    const main = screen.getByTestId("watchlist-page-marker").closest("main");
    expect(main).toHaveAttribute("data-main-top-layout", "watchlist-flush");
    expect(main?.getAttribute("style")).toMatch(/padding-top:\s*calc\(/);
    expect(main?.getAttribute("style")).not.toMatch(/1\.5rem/);
  });

  test("app shell grid uses items-start so columns grow with content", () => {
    wrap(
      <AppShell session={SESSION} isAdmin={false}>
        <p>Page content</p>
      </AppShell>
    );
    const grid = screen.getByTestId("app-shell-right-column").parentElement;
    expect(grid?.className).toMatch(/(^|\s)items-start(\s|$)/);
  });
});
