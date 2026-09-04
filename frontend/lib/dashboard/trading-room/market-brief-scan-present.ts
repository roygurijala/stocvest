/**
 * ADR-003 UX-D3 — Market Brief scan vs expanded section model (pure).
 *
 * Scan mode (default): greeting, pulse, indices, sectors, one headline.
 * Expanded: movers, prep tiles, additional headlines, macro calendar detail.
 */

export type MarketBriefScanInput = {
  headlines: readonly unknown[];
  movers: { up: readonly unknown[]; down: readonly unknown[] };
  weekAhead: readonly unknown[];
  outcomesRecap: unknown | null;
  watchlistAtClose: readonly unknown[];
  weekInReview: { bestSector: unknown | null; worstSector: unknown | null } | null;
};

/** Number of collapsible bento sections behind “Expand brief”. */
export function countMarketBriefExpandedSections(input: MarketBriefScanInput, showPrep: boolean): number {
  let n = 0;
  if (input.headlines.length > 1) n += 1;
  if (input.movers.up.length > 0 || input.movers.down.length > 0) n += 1;
  if (showPrep && input.weekInReview && (input.weekInReview.bestSector || input.weekInReview.worstSector)) {
    n += 1;
  }
  if (showPrep && input.watchlistAtClose.length > 0) n += 1;
  if (showPrep && input.outcomesRecap) n += 1;
  if (showPrep && input.weekAhead.length > 0) n += 1;
  return n;
}

export function marketBriefExpandButtonLabel(sectionCount: number, expanded: boolean): string | null {
  if (sectionCount <= 0) return null;
  if (expanded) return "Show less";
  return sectionCount === 1 ? "Expand brief · 1 section" : `Expand brief · ${sectionCount} sections`;
}

export function marketBriefScanHeadline<T>(headlines: readonly T[]): T | null {
  return headlines[0] ?? null;
}

export function marketBriefExpandedHeadlines<T>(headlines: readonly T[]): T[] {
  return headlines.length > 1 ? headlines.slice(1) : [];
}
