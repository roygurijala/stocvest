/**
 * Approximate return over the last `sessionsBack` completed daily sessions using closes
 * ordered oldest → newest (typical Polygon aggregate order).
 */
export function pctChangeOverDailySessions(closes: number[], sessionsBack = 5): number | null {
  if (closes.length < 2) return null;
  const k = Math.min(Math.max(1, sessionsBack), closes.length - 1);
  const start = closes[closes.length - 1 - k];
  const end = closes[closes.length - 1];
  if (!(start > 0) || !(end > 0)) return null;
  return ((end - start) / start) * 100;
}
