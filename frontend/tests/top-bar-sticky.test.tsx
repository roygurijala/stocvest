/**
 * Lock-in: the dashboard TopBar is sticky to the viewport while the
 * body scrolls.
 *
 * Two invariants together produce sticky behaviour:
 *
 *   1. The ``<header>`` element rendered by ``TopBar`` carries
 *      ``position: sticky`` + ``top: 0`` + a z-index high enough to
 *      sit above page content (we target ``z-30``, which is below
 *      our modal/drawer layer at 40+).
 *
 *   2. The ``AppShell`` right-column wrapper does NOT apply any
 *      ``overflow`` property — that would promote the wrapper to a
 *      scroll container and capture the sticky against the wrapper
 *      instead of the viewport, defeating the whole point. Horizontal
 *      overflow protection lives on ``<main>`` instead.
 *
 * The two assertions in this file fail loudly if a future refactor
 * either drops the sticky classes from ``TopBar`` or re-introduces
 * ``overflow-x-hidden`` (or anything else that promotes a scroll
 * container) onto the right column wrapper. See
 * ``docs/CONTEXT.md`` row 14 for the regression that motivated the
 * change.
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

describe("TopBar sticky positioning", () => {
  test("header carries the sticky classes that pin it during scroll", () => {
    wrap(<TopBar />);
    const header = screen.getByTestId("app-top-bar");
    const cls = header.className;
    // ``sticky`` + ``top-0`` together produce ``position: sticky; top: 0``.
    // ``z-30`` keeps it above page content but below modals (40+).
    expect(cls).toMatch(/(^|\s)sticky(\s|$)/);
    expect(cls).toMatch(/(^|\s)top-0(\s|$)/);
    expect(cls).toMatch(/(^|\s)z-30(\s|$)/);
  });
});

describe("AppShell sticky-friendly layout", () => {
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

  test("<main> still carries overflow-x-hidden so wide content can't blow the column out", () => {
    wrap(
      <AppShell session={SESSION} isAdmin={false}>
        <p data-testid="page-marker">Page content</p>
      </AppShell>
    );
    const main = screen.getByTestId("page-marker").closest("main");
    expect(main).not.toBeNull();
    expect(main!.className).toMatch(/(^|\s)overflow-x-hidden(\s|$)/);
  });
});
