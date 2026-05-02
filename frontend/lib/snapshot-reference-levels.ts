import type { SnapshotPayload } from "@/lib/api/market";

/** Same scale check as backend `PolygonClient._session_day_prices_align_with_last` (5×). */
const DAY_VS_LAST_MAX_RATIO = 5;

function sessionDayPricesAlignWithLast(
  last: number,
  fields: Array<number | null | undefined>
): boolean {
  for (const m of fields) {
    if (m == null || typeof m !== "number" || !Number.isFinite(m) || m <= 0) {
      continue;
    }
    if (m / last > DAY_VS_LAST_MAX_RATIO || last / m > DAY_VS_LAST_MAX_RATIO) {
      return false;
    }
  }
  return true;
}

function hasValidLastTradePrice(last: number | null | undefined): last is number {
  return last != null && typeof last === "number" && Number.isFinite(last) && last > 0;
}

/**
 * Drop session OHLC/VWAP/volume only when `last_trade_price` is a positive number and
 * disagrees with session prices by more than `DAY_VS_LAST_MAX_RATIO`. If last is missing,
 * keep Polygon's session bar so the UI does not fall back to n/a.
 */
export function coerceSnapshotForReferenceLevels(snapshot: SnapshotPayload | null): SnapshotPayload | null {
  if (!snapshot) {
    return null;
  }
  const last = snapshot.last_trade_price;
  if (!hasValidLastTradePrice(last)) {
    return snapshot;
  }
  const ok = sessionDayPricesAlignWithLast(last, [
    snapshot.day_open,
    snapshot.day_high,
    snapshot.day_low,
    snapshot.day_vwap
  ]);
  if (ok) {
    return snapshot;
  }
  return {
    ...snapshot,
    day_open: undefined,
    day_high: undefined,
    day_low: undefined,
    day_volume: undefined,
    day_vwap: undefined
  };
}
