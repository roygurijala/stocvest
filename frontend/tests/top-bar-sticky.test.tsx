/**
 * Lock-in: the dashboard TopBar stays pinned to the viewport while the
 * body scrolls.
 *
 * Two invariants together produce that behaviour:
 *
 *   1. The ``<header>`` rendered by ``TopBar`` uses ``position: fixed``
 *      + ``top: 0`` + ``left-0`` / ``lg:left-[248px]`` (sidebar width)
 *      + ``z-30`` (below modals at 40+).
 *
 *   2. The ``AppShell`` right-column wrapper does NOT apply any
 *      ``overflow`` property — that would promote the wrapper to a
 *      scroll container and complicate layout. Horizontal overflow
 *      protection lives on ``<main>``, which also carries extra
 *      ``padding-top`` so content clears the fixed bar.
 *
 * These assertions fail loudly if a future refactor drops the fixed
 * positioning classes or re-introduces horizontal/vertical overflow
 * (scroll-container promotion) onto the right column wrapper.
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

describe("AppShell layout (no scroll trap on right column)", () => {
  test("right column wrapper does NOT create a scroll container that breaks sticky", () => {
    wrap(
      <AppShell session={SESSION} isAdmin={false}>
        <p>Page content</p>
      </AppShell>
    );
    const rightCol = screen.getByTestId("app-shell-right-column");
    // None of these classes should appear on the wrapper — each one
    // would promote it to a scroll container and capture the sticky
    // header against the wrapper instead of the viewport.
    expect(rightCol.className).not.toMatch(/(^|\s)overflow-x-hidden(\s|$)/);
    expect(rightCol.className).not.toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(rightCol.className).not.toMatch(/(^|\s)overflow-hidden(\s|$)/);
    expect(rightCol.className).not.toMatch(/(^|\s)overflow-auto(\s|$)/);
  });

  test("<main> uses overflow-x-clip so wide content is clipped without breaking sticky", () => {
    wrap(
      <AppShell session={SESSION} isAdmin={false}>
        <p data-testid="page-marker">Page content</p>
      </AppShell>
    );
    const main = screen.getByTestId("page-marker").closest("main");
    expect(main).not.toBeNull();
    // ``overflow-x-hidden`` on ``<main>`` can promote a scroll container
    // that traps ``position: sticky``; ``clip`` clips overflow without that.
    expect(main!.className).toMatch(/(^|\s)overflow-x-clip(\s|$)/);
  });
});
