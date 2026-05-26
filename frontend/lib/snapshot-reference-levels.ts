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

export interface SessionReferenceLevels {
  vwap: number | null;
  support: number | null;
  resistance: number | null;
}

function positiveNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return v;
  }
  return null;
}

/**
 * Tradeable anchor for reference geometry and command-bar price — matches desk display order.
 * Equities after hours: no `last_trade_price`; extended-hours or session close still count.
 */
export function effectiveSnapshotPrice(snapshot: SnapshotPayload | null | undefined): number | null {
  if (!snapshot) return null;
  return (
    positiveNum(snapshot.last_trade_price) ??
    positiveNum(snapshot.after_hours_price) ??
    positiveNum(snapshot.pre_market_price) ??
    positiveNum(snapshot.day_close) ??
    positiveNum(snapshot.prev_close)
  );
}

/**
 * VWAP / support / resistance for dashboard strips. Uses snapshot session fields when last is missing;
 * fills gaps from composite API evidence (`historical_entry_zone`, targets, `vwap`) when present.
 */
export function deriveSessionReferenceLevels(
  snapshot: SnapshotPayload | null | undefined,
  composite: Record<string, unknown> | null | undefined
): SessionReferenceLevels {
  let support: number | null = null;
  let resistance: number | null = null;
  let vwap: number | null = null;

  if (snapshot) {
    const last = effectiveSnapshotPrice(snapshot);
    const dh = positiveNum(snapshot.day_high);
    const dl = positiveNum(snapshot.day_low);
    const dVwap = positiveNum(snapshot.day_vwap);
    if (last != null) {
      support = dl ?? last * 0.985;
      resistance = dh ?? last * 1.015;
      vwap = dVwap ?? last * 0.997;
    } else if (dl != null && dh != null) {
      const lo = Math.min(dl, dh);
      const hi = Math.max(dl, dh);
      if (hi > lo) {
        support = lo;
        resistance = hi;
        vwap = dVwap ?? (lo + hi) / 2;
      }
    } else {
      vwap = dVwap;
    }
  }

  if (composite && typeof composite === "object") {
    const zone = composite["historical_entry_zone"];
    if (zone && typeof zone === "object") {
      const z = zone as Record<string, unknown>;
      const lo = positiveNum(z["low"]);
      const hi = positiveNum(z["high"]);
      if (lo != null && hi != null && hi > lo) {
        if (support == null) support = lo;
        if (resistance == null) resistance = hi;
      }
    }
    const stop = positiveNum(composite["reference_stop_level"]);
    const t1 = positiveNum(composite["reference_target_1"]);
    if (support == null && stop != null) {
      support = stop;
    }
    if (resistance == null && t1 != null) {
      resistance = t1;
    }
    const cv = positiveNum(composite["vwap"] ?? composite["day_vwap"]);
    if (vwap == null && cv != null) {
      vwap = cv;
    }
    if (vwap == null && support != null && resistance != null && resistance > support) {
      vwap = (support + resistance) / 2;
    }
  }

  return { vwap, support, resistance };
}
