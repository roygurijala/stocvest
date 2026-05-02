import type { SnapshotPayload } from "@/lib/api/market";

/** Same scale check as backend `PolygonClient._session_day_prices_align_with_last` (2.5×). */
const DAY_VS_LAST_MAX_RATIO = 2.5;

function sessionDayPricesAlignWithLast(
  last: number | null | undefined,
  fields: Array<number | null | undefined>
): boolean {
  if (last == null || typeof last !== "number" || !Number.isFinite(last) || last <= 0) {
    return true;
  }
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

/**
 * Drop session OHLC/VWAP/volume when they disagree with `last_trade_price` so UI never
 * mixes Polygon's last print with a stale/wrong `day` aggregate.
 */
export function coerceSnapshotForReferenceLevels(snapshot: SnapshotPayload | null): SnapshotPayload | null {
  if (!snapshot) {
    return null;
  }
  const last = snapshot.last_trade_price;
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
