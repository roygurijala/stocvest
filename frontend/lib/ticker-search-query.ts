/** Minimum typed length before firing remote ticker search (1 = F, T, C, V, etc.). */
export const TICKER_SEARCH_MIN_QUERY_LENGTH = 1;

export function isTickerSearchQueryReady(raw: string): boolean {
  return raw.trim().length >= TICKER_SEARCH_MIN_QUERY_LENGTH;
}
