"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Tiny client-side paginator hook used by every admin list surface
 * that DOES NOT have a backend cursor (audit feed, proposal list,
 * future surfaces).
 *
 * ## Why client-side?
 *
 * The user's rule for the admin section is: "show all by default; if
 * more than 25 use pagination; replicate everywhere". The Users page
 * gets free cursor pagination from Cognito (it returns a
 * `PaginationToken`), but the audit and proposal endpoints currently
 * return a single bounded list with no `next_token`. Adding real
 * cursor pagination would mean a backend change on each route — out
 * of scope for a UX consistency fix.
 *
 * Instead we fetch a sensible upper-bound batch once (e.g. 500 rows),
 * slice it into pages of 25 client-side, and feed the slice into the
 * existing `<AdminListPager />` component. The user sees the exact
 * same Prev / Next / "Page N · X of 25 rows" UX everywhere; the only
 * compromise is that the implicit "go to page 10" requires N clicks
 * instead of typing a page number, which is the same trade-off the
 * Users page already makes.
 *
 * ## Why a hook (not a component)?
 *
 * Different surfaces have different filters (audit has module +
 * route_prefix, proposals has status, future surfaces will have
 * their own). A hook keeps the pagination math in one place while
 * letting each page own its filter UI, fetch loop, and row rendering.
 *
 * ## Contract for callers
 *
 *   1. Set `allItems` to the full fetched batch whenever it changes
 *      (filter change, refresh, etc.). Pass the same array reference
 *      back when it hasn't changed.
 *   2. Call `goToFirstPage()` from a `useEffect` keyed on the filter
 *      values so a filter switch always lands the user on page 1
 *      (the most useful page) instead of staying on, say, page 3 of
 *      the previous filter.
 *   3. Render `pageItems` instead of `allItems` in the list view.
 *   4. Render `<AdminListPager />` only if `totalCount > pageSize` —
 *      a 0-25 row list with a "Page 1 · 12 of 25 rows" footer looks
 *      noisy; the hook returns `shouldShowPager` to make that gate a
 *      one-liner at the call site.
 */
export interface ClientPaginatorConfig<T> {
  /** The full pre-fetched batch. The hook treats this as
   *  authoritative — slice math is recomputed whenever it changes. */
  allItems: T[];
  /** How many rows to display per page. Defaults to 25 to match the
   *  Users page contract; do not deviate without a strong reason. */
  pageSize?: number;
}

export interface ClientPaginatorState<T> {
  /** Current 0-indexed page. */
  pageIndex: number;
  /** Rows in the current visible page. */
  pageItems: T[];
  /** Total number of rows across all pages. */
  totalCount: number;
  /** Page size in use (echoed for the pager). */
  pageSize: number;
  /** True if there is at least one more page after the current one. */
  hasNext: boolean;
  /** True if `pageIndex > 0`. */
  hasPrev: boolean;
  /** True if `totalCount > pageSize`. Use this as the
   *  render-the-pager-or-not gate. */
  shouldShowPager: boolean;
  /** Advance to the next page. No-op if `!hasNext`. */
  goToNextPage: () => void;
  /** Step back one page. No-op if `!hasPrev`. */
  goToPrevPage: () => void;
  /** Reset to page 0. Use from a filter-change effect. */
  goToFirstPage: () => void;
}

export function useClientPaginator<T>({
  allItems,
  pageSize = 25
}: ClientPaginatorConfig<T>): ClientPaginatorState<T> {
  const [pageIndex, setPageIndex] = useState(0);
  const totalCount = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // If the batch shrinks (filter applied, refresh returned fewer rows)
  // and we're past the last page, snap back to a valid page so the
  // table doesn't render empty while the pager still claims "Page 7".
  useEffect(() => {
    if (pageIndex > 0 && pageIndex >= totalPages) {
      setPageIndex(totalPages - 1);
    }
  }, [pageIndex, totalPages]);

  const pageItems = useMemo(() => {
    const start = pageIndex * pageSize;
    return allItems.slice(start, start + pageSize);
  }, [allItems, pageIndex, pageSize]);

  const hasNext = pageIndex + 1 < totalPages;
  const hasPrev = pageIndex > 0;
  const shouldShowPager = totalCount > pageSize;

  const goToNextPage = useCallback(() => {
    setPageIndex((prev) => (prev + 1 < totalPages ? prev + 1 : prev));
  }, [totalPages]);

  const goToPrevPage = useCallback(() => {
    setPageIndex((prev) => (prev > 0 ? prev - 1 : prev));
  }, []);

  const goToFirstPage = useCallback(() => {
    setPageIndex(0);
  }, []);

  return {
    pageIndex,
    pageItems,
    totalCount,
    pageSize,
    hasNext,
    hasPrev,
    shouldShowPager,
    goToNextPage,
    goToPrevPage,
    goToFirstPage
  };
}
