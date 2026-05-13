/**
 * Lock-in tests for `<AdminListPager />` — the reusable token-based
 * pager that the Admin Users page (and, going forward, every other
 * admin list backed by an upstream-paginated service) renders below
 * its result list.
 *
 * These tests pin the structural behaviour callers depend on:
 *
 *   * Page index is shown 1-indexed in the status line even though
 *     the prop is 0-indexed (a real off-by-one regression risk).
 *   * Prev is disabled iff `pageIndex === 0` (or `loading`).
 *   * Next is disabled iff `!hasNext` (or `loading`).
 *   * The component carries `data-page-index`, `data-has-next`,
 *     `data-has-prev` so integration tests on consumer pages can
 *     read pagination state without re-implementing it.
 *
 * We deliberately don't test the visual styling — that's covered
 * implicitly by the React render not crashing under the
 * `ThemeProvider`.
 */

import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { AdminListPager } from "@/components/admin/admin-list-pager";
import { ThemeProvider } from "@/lib/theme-provider";

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

const noop = () => {};

describe("<AdminListPager />", () => {
  test("renders 1-indexed page number in status line", () => {
    wrap(
      <AdminListPager
        pageIndex={0}
        hasPrev={false}
        hasNext={true}
        visibleCount={25}
        pageSize={25}
        onPrev={noop}
        onNext={noop}
      />
    );
    // Off-by-one risk: the prop is 0-indexed, the UI must say "Page 1".
    expect(screen.getByTestId("admin-list-pager-status").textContent).toMatch(
      /Page 1/
    );
  });

  test("status shows visible / page-size counts", () => {
    wrap(
      <AdminListPager
        pageIndex={2}
        hasPrev={true}
        hasNext={true}
        visibleCount={13}
        pageSize={25}
        onPrev={noop}
        onNext={noop}
      />
    );
    const status = screen.getByTestId("admin-list-pager-status").textContent || "";
    expect(status).toMatch(/Page 3/);
    expect(status).toMatch(/13/);
    expect(status).toMatch(/25/);
  });

  test("Prev is disabled on page 0", () => {
    wrap(
      <AdminListPager
        pageIndex={0}
        hasPrev={false}
        hasNext={true}
        visibleCount={25}
        pageSize={25}
        onPrev={noop}
        onNext={noop}
      />
    );
    const prev = screen.getByTestId("admin-list-pager-prev") as HTMLButtonElement;
    const next = screen.getByTestId("admin-list-pager-next") as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
  });

  test("Next is disabled when hasNext is false", () => {
    wrap(
      <AdminListPager
        pageIndex={3}
        hasPrev={true}
        hasNext={false}
        visibleCount={7}
        pageSize={25}
        onPrev={noop}
        onNext={noop}
      />
    );
    const prev = screen.getByTestId("admin-list-pager-prev") as HTMLButtonElement;
    const next = screen.getByTestId("admin-list-pager-next") as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(true);
  });

  test("loading disables both regardless of hasPrev / hasNext", () => {
    // Important: in-flight fetches must lock both buttons so a fast
    // click doesn't race the previous request and end up on the
    // wrong page (token stack would desync).
    wrap(
      <AdminListPager
        pageIndex={1}
        hasPrev={true}
        hasNext={true}
        loading
        visibleCount={25}
        pageSize={25}
        onPrev={noop}
        onNext={noop}
      />
    );
    expect((screen.getByTestId("admin-list-pager-prev") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("admin-list-pager-next") as HTMLButtonElement).disabled).toBe(true);
  });

  test("clicking Next invokes onNext exactly once", () => {
    const onNext = vi.fn();
    wrap(
      <AdminListPager
        pageIndex={0}
        hasPrev={false}
        hasNext={true}
        visibleCount={25}
        pageSize={25}
        onPrev={noop}
        onNext={onNext}
      />
    );
    fireEvent.click(screen.getByTestId("admin-list-pager-next"));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  test("clicking Prev invokes onPrev exactly once", () => {
    const onPrev = vi.fn();
    wrap(
      <AdminListPager
        pageIndex={2}
        hasPrev={true}
        hasNext={true}
        visibleCount={25}
        pageSize={25}
        onPrev={onPrev}
        onNext={noop}
      />
    );
    fireEvent.click(screen.getByTestId("admin-list-pager-prev"));
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  test("disabled Next ignores click (no callback fired)", () => {
    const onNext = vi.fn();
    wrap(
      <AdminListPager
        pageIndex={0}
        hasPrev={false}
        hasNext={false}
        visibleCount={3}
        pageSize={25}
        onPrev={noop}
        onNext={onNext}
      />
    );
    fireEvent.click(screen.getByTestId("admin-list-pager-next"));
    expect(onNext).not.toHaveBeenCalled();
  });

  test("data attributes mirror prop state for integration tests", () => {
    wrap(
      <AdminListPager
        pageIndex={4}
        hasPrev={true}
        hasNext={false}
        visibleCount={2}
        pageSize={25}
        onPrev={noop}
        onNext={noop}
      />
    );
    const root = screen.getByTestId("admin-list-pager");
    expect(root.getAttribute("data-page-index")).toBe("4");
    expect(root.getAttribute("data-has-prev")).toBe("true");
    expect(root.getAttribute("data-has-next")).toBe("false");
  });
});
