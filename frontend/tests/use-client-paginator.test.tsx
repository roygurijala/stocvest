/**
 * Lock-in tests for `useClientPaginator`.
 *
 * This hook backs the consistent "show all by default, paginate at
 * 25" rule across every admin list page that doesn't have a backend
 * cursor (Audit, Proposals, future surfaces). Behaviour locked here:
 *
 *   * Defaults to page 0 with the first slice of the input.
 *   * `goToNextPage` / `goToPrevPage` clamp at boundaries.
 *   * `shouldShowPager` is true only when total > pageSize (matches
 *     the Users page contract — a 0-25 row list has no pager footer).
 *   * If the underlying batch shrinks below the current page (filter
 *     change, refresh returns fewer rows), the hook snaps back to a
 *     valid page so the table doesn't render empty.
 *   * `goToFirstPage` is referentially stable enough to be used as a
 *     `useEffect` dependency from the caller (the call sites in audit
 *     + proposals both depend on it).
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { useClientPaginator } from "@/components/admin/use-client-paginator";

function range(n: number): { id: number }[] {
  return Array.from({ length: n }, (_, i) => ({ id: i }));
}

describe("useClientPaginator", () => {
  test("test_default_state_returns_first_slice_at_page_zero", () => {
    const { result } = renderHook(() =>
      useClientPaginator({ allItems: range(60), pageSize: 25 })
    );
    expect(result.current.pageIndex).toBe(0);
    expect(result.current.pageItems).toHaveLength(25);
    expect(result.current.pageItems[0]).toEqual({ id: 0 });
    expect(result.current.pageItems[24]).toEqual({ id: 24 });
    expect(result.current.totalCount).toBe(60);
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrev).toBe(false);
    expect(result.current.shouldShowPager).toBe(true);
  });

  test("test_should_show_pager_is_false_for_small_lists", () => {
    // 25 rows or fewer => no pager footer. Mirrors the Users page
    // contract: a one-page list shouldn't render "Page 1 · N of 25
    // rows" as that's visual noise.
    const { result } = renderHook(() =>
      useClientPaginator({ allItems: range(25), pageSize: 25 })
    );
    expect(result.current.shouldShowPager).toBe(false);
    expect(result.current.hasNext).toBe(false);
    expect(result.current.pageItems).toHaveLength(25);
  });

  test("test_go_to_next_page_advances_and_clamps", () => {
    const { result } = renderHook(() =>
      useClientPaginator({ allItems: range(60), pageSize: 25 })
    );
    act(() => result.current.goToNextPage());
    expect(result.current.pageIndex).toBe(1);
    expect(result.current.pageItems[0]).toEqual({ id: 25 });
    expect(result.current.pageItems).toHaveLength(25);

    act(() => result.current.goToNextPage());
    expect(result.current.pageIndex).toBe(2);
    expect(result.current.pageItems).toHaveLength(10); // 60 - 50 = 10
    expect(result.current.hasNext).toBe(false);

    // Already on the last page — calling next is a no-op.
    act(() => result.current.goToNextPage());
    expect(result.current.pageIndex).toBe(2);
  });

  test("test_go_to_prev_page_steps_back_and_clamps_at_zero", () => {
    const { result } = renderHook(() =>
      useClientPaginator({ allItems: range(60), pageSize: 25 })
    );
    act(() => result.current.goToNextPage());
    act(() => result.current.goToNextPage());
    expect(result.current.pageIndex).toBe(2);

    act(() => result.current.goToPrevPage());
    expect(result.current.pageIndex).toBe(1);
    act(() => result.current.goToPrevPage());
    expect(result.current.pageIndex).toBe(0);
    // Already on page 0 — prev is a no-op.
    act(() => result.current.goToPrevPage());
    expect(result.current.pageIndex).toBe(0);
    expect(result.current.hasPrev).toBe(false);
  });

  test("test_batch_shrink_snaps_page_index_back_into_range", () => {
    // Simulate the admin filter scenario: user navigates to page 3,
    // then a new filter is applied and the result set shrinks to a
    // single page. The hook must NOT keep rendering page 3 of a
    // 1-page batch — that would show an empty table with "Page 4 ·
    // 0 of 25 rows" in the footer. Instead it snaps back to the
    // last valid page.
    const { result, rerender } = renderHook(
      ({ items }: { items: { id: number }[] }) =>
        useClientPaginator({ allItems: items, pageSize: 25 }),
      { initialProps: { items: range(80) } }
    );
    act(() => result.current.goToNextPage());
    act(() => result.current.goToNextPage());
    act(() => result.current.goToNextPage());
    expect(result.current.pageIndex).toBe(3);

    rerender({ items: range(10) });
    // After the rerender effect snaps the index back into [0, 0]:
    expect(result.current.pageIndex).toBe(0);
    expect(result.current.pageItems).toHaveLength(10);
    expect(result.current.shouldShowPager).toBe(false);
  });

  test("test_go_to_first_page_resets_to_zero", () => {
    const { result } = renderHook(() =>
      useClientPaginator({ allItems: range(60), pageSize: 25 })
    );
    act(() => result.current.goToNextPage());
    act(() => result.current.goToNextPage());
    expect(result.current.pageIndex).toBe(2);
    act(() => result.current.goToFirstPage());
    expect(result.current.pageIndex).toBe(0);
  });
});
