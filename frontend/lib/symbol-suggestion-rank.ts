/**
 * Symbol typeahead relevance ranking.
 *
 * The signals page's symbol input has two typeaheads (committed
 * symbol + past-signals history filter). Both fuse three sources of
 * candidates — scanner setups, gap intel, market overview snapshots
 * for the local pool, plus Polygon search results for remote — and
 * both used to sort matches alphabetically by ticker after a loose
 * `symbol.startsWith(q) || label.includes(q)` filter.
 *
 * That produced the user-reported UX bug: typing "AP" surfaced
 * "AAPL — Apple Inc." (matched via `label.includes("ap")`) ahead of
 * "APP — AppLovin Corp." (matched via `symbol.startsWith("ap")`),
 * because alphabetically `AAPL < APP`. The user's mental model when
 * typing in a ticker box is "show me ticker matches first, then the
 * company-name matches if any remain" — exactly the order Bloomberg,
 * Yahoo Finance, and TradingView all use.
 *
 * This module encodes that ranking once so:
 *   * Both typeaheads share identical behaviour.
 *   * The ranker is a pure function and trivially unit-testable.
 *   * Remote (Polygon) results can be ranked with the same buckets,
 *     preventing remote inserts from re-disordering the merged list.
 *
 * ## Buckets (lower = more relevant, top of the dropdown)
 *
 *   0  Exact ticker match           (`symbol === q`)
 *   1  Ticker prefix match          (`symbol.startsWith(q)`)
 *   2  Ticker contains query        (`symbol.includes(q)`)
 *   3  Company name starts with     (company portion starts with `q`)
 *   4  Company name contains query  (company portion includes `q`)
 *   −1 (drop) no field matched
 *
 * Within each bucket we sort alphabetically by ticker so deterministic
 * order survives between renders / snapshot tests.
 *
 * ## Empty query
 *
 * An empty query returns the input array unmodified — the caller is
 * expected to apply its own "default suggestions" policy (typically
 * "show the first N from the local candidate pool"). This keeps the
 * ranker focused on the relevance question; "what do we show when the
 * user hasn't typed yet" is a separate concern owned by the call site.
 */

export interface RankableSymbolCandidate {
  /** Already-normalised ticker, uppercase. */
  symbol: string;
  /**
   * Display label. Typically `"AAPL — Apple Inc."` (so `label` is a
   * superset of `symbol` plus the company name). The ranker tolerates
   * a bare `"AAPL"` label too — it just won't trigger the
   * company-name bucket.
   */
  label: string;
}

/**
 * Rank score for a single candidate. Exported so callers that want
 * to render the matching reason in the UI (e.g. "by company name")
 * can inspect it.
 */
export type SymbolMatchBucket = 0 | 1 | 2 | 3 | 4 | -1;

export function scoreSymbolCandidate(
  candidate: RankableSymbolCandidate,
  normalizedQuery: string
): SymbolMatchBucket {
  if (!normalizedQuery) return -1;
  const sym = candidate.symbol.toLowerCase();
  if (sym === normalizedQuery) return 0;
  if (sym.startsWith(normalizedQuery)) return 1;
  if (sym.includes(normalizedQuery)) return 2;
  const label = candidate.label.toLowerCase();
  // Strip the redundant `${SYMBOL} —` prefix from the label so a
  // ticker-only candidate (`label === "AAPL"`) doesn't accidentally
  // qualify as a company-name match. Bucket 3 should only fire for
  // candidates whose company name actually contains the query.
  const companyPortion = stripSymbolPrefixFromLabel(label, sym);
  if (companyPortion.startsWith(normalizedQuery)) return 3;
  if (companyPortion.includes(normalizedQuery)) return 4;
  return -1;
}

function stripSymbolPrefixFromLabel(label: string, lowerSymbol: string): string {
  // Labels look like `"aapl — apple inc."` (em-dash is the canonical
  // separator from `symbolCandidates`). We only need to remove that
  // prefix for the bucket-3 check; the original label is preserved
  // for display.
  if (!label.startsWith(lowerSymbol)) return label;
  const rest = label.slice(lowerSymbol.length).trimStart();
  // Common separators we emit (em-dash, en-dash, hyphen, pipe) — any
  // one of them means "the rest is the company name".
  if (rest.startsWith("—") || rest.startsWith("–") || rest.startsWith("-") || rest.startsWith("|")) {
    return rest.replace(/^[—–\-|]\s*/, "");
  }
  return label;
}

/**
 * Rank a candidate list by ticker-first relevance.
 *
 * @param candidates  Local + remote candidates already deduplicated by
 *                    symbol; the ranker does NOT dedupe.
 * @param rawQuery    Whatever the user typed; will be trimmed and
 *                    lowercased internally.
 *
 * @returns A new array with the same candidates, sorted so that
 *          ticker matches come before company-name matches.
 *          Non-matching candidates are dropped entirely.
 *          Empty query => unchanged input.
 */
export function rankSymbolCandidates<T extends RankableSymbolCandidate>(
  candidates: readonly T[],
  rawQuery: string
): T[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return candidates.slice();
  const scored: { c: T; bucket: SymbolMatchBucket }[] = [];
  for (const c of candidates) {
    const bucket = scoreSymbolCandidate(c, q);
    if (bucket >= 0) scored.push({ c, bucket });
  }
  scored.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    return a.c.symbol.localeCompare(b.c.symbol);
  });
  return scored.map((s) => s.c);
}
