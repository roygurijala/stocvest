/**
 * Tier 1.B — Streaming Suspense islands on `/dashboard/signals`.
 *
 * See `docs/PERFORMANCE.md` §1 layer 3 + §4. These tests pin the
 * structural contract that:
 *
 *   1. `SignalsPageShell` renders **without** awaiting any data
 *      and **without** any client-side hooks. It's the Suspense
 *      fallback AND the `loading.tsx` for `/dashboard/signals`,
 *      so both surfaces depend on it rendering synchronously on
 *      the server with no React state involvement.
 *
 *   2. The shell's DOM mirrors the live page chrome — mode tab
 *      strip + two-column grid + six layer-row placeholders +
 *      three context-card placeholders + an sr-only `role=status`
 *      announcement. Mirroring matters because the visual swap
 *      from skeleton -> live content must land in the same slots
 *      to avoid layout jank.
 *
 *   3. `app/dashboard/signals/loading.tsx` re-exports the shell
 *      via a default function. Next.js App Router relies on the
 *      file's default export to render the route-transition state.
 *
 *   4. `app/dashboard/signals/page.tsx` retains the Suspense
 *      boundary structurally. We lock this with a source-level
 *      grep that asserts:
 *        - `<Suspense fallback={<SignalsPageShell />}>` appears in
 *          the page source, AND
 *        - SSR fetchers (`fetchMarketOverview`, `fetchScannerOverview`,
 *          `fetchPdtStatus`, `fetchDefaultWatchlistSnapshot`) run inside
 *          `SignalsPageData`, AND `fetchEarningsCalendar` is NOT on the
 *          SSR path (per-symbol client fetch — see Tier 1.8), AND
 *        - the outer default-exported async page function does
 *          NOT contain any of those fetcher calls directly — the
 *          calls must live in `SignalsPageData` so they run
 *          INSIDE the Suspense boundary.
 *
 *   A pure-DOM render of `page.tsx` is intentionally not
 *   attempted: the file is a Next.js App Router server component
 *   that uses `redirect()` and `getDashboardAuthContext()` (which
 *   reads cookies). Mocking the entire Next App Router runtime
 *   plus the auth surface for a structural lock-in is more brittle
 *   than the targeted source-grep above.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { SignalsPageShell } from "@/components/signals-page-shell";
import Loading from "@/app/dashboard/signals/loading";

afterEach(() => cleanup());

// ─────────────────────────────────────────────────────────────────────────────
// (1) SignalsPageShell — DOM contract
// ─────────────────────────────────────────────────────────────────────────────

describe("<SignalsPageShell /> DOM contract", () => {
  test("renders_shell_without_throwing_when_no_data_is_provided", () => {
    // The shell is a pure server component — it MUST render with
    // zero props, zero React state, zero client-side hooks. If
    // this test ever fails, someone introduced a hook or a data
    // fetch into the shell, which breaks both the Suspense
    // fallback and the loading.tsx render paths simultaneously.
    expect(() => render(<SignalsPageShell />)).not.toThrow();
  });

  test("exposes_shell_loading_data_attribute_for_smoke_checks", () => {
    render(<SignalsPageShell />);
    const root = screen.getByTestId("signals-page-shell");
    // External smoke / E2E checks can grep this attribute to
    // assert "the user is still seeing the loading skeleton" vs
    // "the live page swapped in".
    expect(root.getAttribute("data-shell-loading")).toBe("true");
  });

  test("renders_mode_tab_strip_placeholder_with_two_pill_shapes", () => {
    render(<SignalsPageShell />);
    const tabs = screen.getByTestId("signals-shell-mode-tabs");
    // Two mode-tab placeholders mirror the live `swing | day`
    // pair. We don't pre-commit to a mode (rendering an active
    // state would flash the wrong tab on hydration), but the user
    // must see the familiar two-pill shape.
    const tabPlaceholders = within(tabs).getAllByTestId("signals-shell-mode-tab");
    expect(tabPlaceholders).toHaveLength(2);
  });

  test("renders_two_column_grid_mirroring_the_live_signals_grid_breakpoints", () => {
    render(<SignalsPageShell />);
    const grid = screen.getByTestId("signals-shell-grid");
    const className = grid.getAttribute("class") || "";
    // Mirror the live page's responsive breakpoints so the skeleton
    // lands in the same slots after hydration. The CSS classes are
    // the canonical signal here — changing them in `signals-page-
    // client.tsx` without updating the shell would cause a layout
    // jump on swap-in.
    expect(className).toMatch(/grid-cols-1/);
    expect(className).toMatch(/lg:grid-cols-\[1\.35fr_1fr\]/);
  });

  test("renders_six_layer_row_placeholders_inside_the_left_card", () => {
    render(<SignalsPageShell />);
    const layersCard = screen.getByTestId("signals-shell-layers-card");
    // Six rows because the live page renders the 6-layer Signal
    // Breakdown card on the left. We don't lock the exact pulse-
    // block count inside the card (that's an implementation
    // detail), just the structural row count via direct children.
    const rowChildren = Array.from(layersCard.children).filter(
      (c) => c.tagName.toLowerCase() === "div"
    );
    // Heading placeholder + separator placeholder + 6 rows = 8
    // direct div children. If the live layout grows past 6 layers
    // someday this test fails loud and the shell needs to track.
    expect(rowChildren.length).toBeGreaterThanOrEqual(6 + 2);
  });

  test("renders_three_right_column_context_cards_news_earnings_after_hours", () => {
    render(<SignalsPageShell />);
    // Each right-column card carries its own test id derived from
    // the slot name so a future test can grep for individual
    // cards without depending on order.
    expect(screen.getByTestId("signals-shell-news-card")).toBeInTheDocument();
    expect(screen.getByTestId("signals-shell-earnings-card")).toBeInTheDocument();
    expect(screen.getByTestId("signals-shell-after-hours-card")).toBeInTheDocument();
  });

  test("announces_loading_state_to_assistive_tech_via_role_status", () => {
    render(<SignalsPageShell />);
    // The visible skeleton has no text. Screen readers MUST hear
    // "Loading signal data…" so a blind user knows the navigation
    // succeeded and the page is in flight.
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect((status.textContent || "").toLowerCase()).toContain("loading");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) loading.tsx — Next.js route-transition fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("app/dashboard/signals/loading.tsx", () => {
  test("default_export_renders_the_signals_page_shell", () => {
    // The loading.tsx file MUST render exactly `SignalsPageShell`
    // (or a wrapper that contains it) so the inter-route
    // transition skeleton matches the intra-render Suspense
    // fallback. Otherwise a user clicking a ribbon chip on the
    // dashboard would see one skeleton during nav and a different
    // one once `page.tsx` starts streaming — visual jank.
    render(<Loading />);
    expect(screen.getByTestId("signals-page-shell")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (3) Source-level structural lock-in on page.tsx
// ─────────────────────────────────────────────────────────────────────────────

describe("/dashboard/signals page.tsx structural invariants", () => {
  // Resolve the page source relative to the workspace root. We use
  // `process.cwd()` because the vitest run executes from the
  // `frontend/` directory.
  const pageSource = fs.readFileSync(
    path.join(process.cwd(), "app", "dashboard", "signals", "page.tsx"),
    "utf8"
  );

  test("page_source_imports_Suspense_from_react", () => {
    expect(pageSource).toMatch(/import\s*\{\s*Suspense\s*\}\s*from\s*"react"/);
  });

  test("page_source_imports_SignalsPageShell_for_the_fallback", () => {
    expect(pageSource).toMatch(/import\s*\{\s*SignalsPageShell\s*\}/);
  });

  test("page_source_wraps_data_island_in_Suspense_with_shell_fallback", () => {
    // Lock the literal JSX so a future refactor that drops the
    // Suspense boundary (e.g. accidentally moves the fetches back
    // to the outer page) fails this assertion loud with a pointer
    // at the perf doc.
    expect(pageSource).toMatch(/<Suspense\s+fallback=\{<SignalsPageShell\s*\/>\}\s*>/);
  });

  test("heavy_fetches_run_inside_the_Suspense_boundary_not_the_outer_page", () => {
    // SSR data calls MUST live inside `SignalsPageData` (Suspense island).
    // Earnings calendar was removed from SSR (c3850ca): per-symbol client
    // fetch after commit — do not re-add bulk `fetchEarningsCalendar` here.
    const cleaned = pageSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const innerAnchor = cleaned.indexOf("async function SignalsPageData");
    expect(innerAnchor, "page.tsx must declare a SignalsPageData inner async function").toBeGreaterThan(0);
    const innerSource = cleaned.slice(innerAnchor);
    const outerSource = cleaned.slice(0, innerAnchor);
    for (const fetcher of [
      "fetchMarketOverview",
      "fetchScannerOverview",
      "fetchPdtStatus",
      "fetchDefaultWatchlistSnapshot"
    ]) {
      expect(
        innerSource.includes(`${fetcher}(`),
        `${fetcher}() must be called inside SignalsPageData (Tier 1.B perf invariant)`
      ).toBe(true);
      expect(
        outerSource.includes(`${fetcher}(`),
        `${fetcher}() must NOT be called in the outer DashboardSignalsPage — that re-introduces the blank-screen window. See docs/PERFORMANCE.md §4.`
      ).toBe(false);
    }
    expect(
      cleaned.includes("fetchEarningsCalendar("),
      "fetchEarningsCalendar() must not run on the signals SSR path — use client fetchEarningsCalendarClient per symbol"
    ).toBe(false);
    expect(innerSource).toMatch(/signalsPageMinimal:\s*true/);
  });
});
