/**
 * Lock-in: the dashboard TopBar stays pinned to the viewport while the
 * page content scrolls inside ``<main>``.
 *
 *   1. ``TopBar`` uses ``position: fixed`` + sidebar offset on ``lg+``.
 *   2. ``AppShell`` right column is viewport-tall; ``<main>`` is the scroll
 *      container (`data-app-scroll-root` + ``overflow-y-auto``).
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

describe("AppShell layout (main scroll container)", () => {
  test("right column is viewport-tall without its own overflow scroll", () => {
    wrap(
      <AppShell session={SESSION} isAdmin={false}>
        <p>Page content</p>
      </AppShell>
    );
    const rightCol = screen.getByTestId("app-shell-right-column");
    expect(rightCol.className).toMatch(/h-\[100dvh\]/);
    expect(rightCol.className).not.toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(rightCol.className).not.toMatch(/(^|\s)overflow-hidden(\s|$)/);
  });

  test("<main> is the scroll root with overflow-y-auto", () => {
    wrap(
      <AppShell session={SESSION} isAdmin={false}>
        <p data-testid="page-marker">Page content</p>
      </AppShell>
    );
    const main = screen.getByTestId("page-marker").closest("main");
    expect(main).not.toBeNull();
    expect(main).toHaveAttribute("data-app-scroll-root");
    expect(main!.className).toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(main!.className).toMatch(/(^|\s)min-h-0(\s|$)/);
  });
});
