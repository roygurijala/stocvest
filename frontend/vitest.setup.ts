import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Global default mock for `next/navigation`.
 *
 * Tier 1 → Layer 4 introduces `useHoverPrefetch`, which calls
 * `useRouter()` from `next/navigation` unconditionally (Rules of
 * Hooks). When a test renders a tree that contains a dashboard
 * `<Link>` with hover-prefetch wiring (ribbon chips, day-desk
 * rows, scanner footers, …), the real `useRouter` throws
 * "invariant expected app router to be mounted" because jsdom
 * has no Next.js app-router context.
 *
 * Adding this default mock keeps every existing test green
 * without forcing each one to add its own `vi.mock("next/
 * navigation", …)`. Tests that need richer router behaviour
 * (assertions on `router.push(...)`, etc.) can still declare
 * their own `vi.mock(...)` at the top of the file — those
 * declarations are hoisted by vitest and override this default.
 *
 * If your test does `vi.mock("next/navigation", () => ({ ... }))`
 * to assert on a specific `router.X` call, that mock wins. If
 * your test does nothing, you inherit the no-op stub below.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn()
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {
    throw new Error("redirect() called in test — mock or import the real module if you need this");
  }
}));
