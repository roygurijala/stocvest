import { canonicalUsTicker, tickersEquivalent } from "@/lib/symbol-ticker";
import { rankSymbolCandidates, type RankableSymbolCandidate } from "@/lib/symbol-suggestion-rank";

/**
 * When the user types a well-formed US ticker (e.g. GS, COIN), Polygon fuzzy search
 * may omit the exact symbol from its top results. Inject the typed ticker so typeaheads
 * always offer an exact match the user can pick or commit.
 */
export function injectTypedTickerCandidate<T extends RankableSymbolCandidate>(
  candidates: readonly T[],
  rawQuery: string
): T[] {
  const typed = canonicalUsTicker(rawQuery.trim());
  if (!typed) return [...candidates];
  if (candidates.some((c) => tickersEquivalent(c.symbol, typed))) return [...candidates];
  return [{ symbol: typed, label: typed } as T, ...candidates];
}

/** Dedupe by symbol, inject typed ticker when applicable, then rank by relevance. */
export function buildRankedSymbolSuggestions<T extends RankableSymbolCandidate>(
  candidates: readonly T[],
  rawQuery: string,
  limit = 12
): T[] {
  const q = rawQuery.trim();
  if (!q) return candidates.slice(0, limit);
  return rankSymbolCandidates(injectTypedTickerCandidate(candidates, q), q).slice(0, limit);
}

export type TickerSearchItem = { symbol: string; name: string };

/** Post-process Polygon / API search rows (BFF routes + marketing search). */
export function finalizeTickerSearchItems(query: string, items: readonly TickerSearchItem[]): TickerSearchItem[] {
  const typed = canonicalUsTicker(query.trim());
  if (!typed) return [...items];
  if (items.some((i) => tickersEquivalent(i.symbol, typed))) return [...items];
  return [{ symbol: typed, name: "" }, ...items];
}
