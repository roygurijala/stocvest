/**
 * Client-safe batched snapshot fetch via the same-origin BFF.
 *
 * Backend caps each request at 40 symbols; this helper chunks automatically.
 */
import type { SnapshotPayload } from "@/lib/api/market";
import { canonicalUsTicker, canonicalUsTickerFromSearch, tickersEquivalent } from "@/lib/symbol-ticker";

export const BFF_SNAPSHOT_BATCH_SIZE = 40;

export async function fetchBffSnapshotsBatched(
  symbols: readonly string[]
): Promise<Map<string, SnapshotPayload>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (uniq.length === 0) return new Map();

  const out = new Map<string, SnapshotPayload>();
  for (let i = 0; i < uniq.length; i += BFF_SNAPSHOT_BATCH_SIZE) {
    const chunk = uniq.slice(i, i + BFF_SNAPSHOT_BATCH_SIZE);
    try {
      const res = await fetch(
        `/api/stocvest/market/snapshots?symbols=${encodeURIComponent(chunk.join(","))}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const json = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
      for (const row of Array.isArray(json.snapshots) ? json.snapshots : []) {
        const sym = (row.symbol || "").trim().toUpperCase();
        if (sym) out.set(sym, row);
      }
    } catch {
      /* quotes are best-effort */
    }
  }
  return out;
}

/** Resolve a snapshot whether the map key is canonical or an alias (BRK-B vs BRK.B). */
export function lookupSnapshot<T extends { symbol?: string | null }>(
  map: ReadonlyMap<string, T>,
  symbol: string
): T | undefined {
  const sym = symbol.trim().toUpperCase();
  const direct = map.get(sym);
  if (direct) return direct;
  const canon = canonicalUsTicker(sym) ?? canonicalUsTickerFromSearch(sym);
  if (canon && canon !== sym) {
    const hit = map.get(canon);
    if (hit) return hit;
  }
  for (const [key, snap] of map) {
    if (tickersEquivalent(key, sym)) return snap;
  }
  return undefined;
}

/** Merge parent tape snapshots with a local fetch map (local wins on conflict). */
export function mergeSnapshotMaps<T>(
  parent: ReadonlyMap<string, T> | undefined,
  local: ReadonlyMap<string, T>
): Map<string, T> {
  const merged = new Map(parent ?? []);
  for (const [sym, snap] of local) merged.set(sym, snap);
  return merged;
}
