/**
 * Pure snapshot price resolution — no runtime dependencies (safe in client bundles).
 *
 * Lives apart from `market.ts` because that module transitively imports server-only
 * code (`next/headers`), which cannot be value-imported into Client Components.
 */

import type { SnapshotPayload } from "@/lib/api/market";

/**
 * Resolve a displayable price from a snapshot. Prefers the live last print, then the
 * session close, then the prior close. Treats non-positive values as missing — over a
 * weekend / closed session Polygon returns `last_trade_price = null` and `day_close = 0`,
 * so the prior (Friday) close is the correct value to show.
 */
export function resolveSnapshotDisplayPrice(
  snap: SnapshotPayload | null | undefined
): number | null {
  if (!snap) return null;
  const positive = (v: number | null | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  return positive(snap.last_trade_price) ?? positive(snap.day_close) ?? positive(snap.prev_close) ?? null;
}
