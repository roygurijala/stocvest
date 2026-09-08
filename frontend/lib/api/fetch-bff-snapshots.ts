/**
 * Client-safe batched snapshot fetch via the same-origin BFF.
 *
 * Backend caps each request at 40 symbols; this helper chunks automatically.
 */
import type { SnapshotPayload } from "@/lib/api/market";

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

/** Merge parent tape snapshots with a local fetch map (local wins on conflict). */
export function mergeSnapshotMaps(
  parent: ReadonlyMap<string, SnapshotPayload> | undefined,
  local: ReadonlyMap<string, SnapshotPayload>
): Map<string, SnapshotPayload> {
  const merged = new Map(parent ?? []);
  for (const [sym, snap] of local) merged.set(sym, snap);
  return merged;
}
