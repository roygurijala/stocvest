/**
 * One POST for all visible scanner gap rows (bounded server-side).
 */

import useSWR from "swr";

import { parseGapIntelSnapshot, type GapIntelSnapshot } from "@/lib/api/gap-intel";
import { STOCVEST_SWR_CACHE_NS } from "@/lib/swr/config";

export type ScannerGapIntelBatchMode = "day" | "swing";

export function useScannerGapIntelBatch(
  symbols: string[],
  mode: ScannerGapIntelBatchMode,
  enabled: boolean
): {
  snapshots: Record<string, GapIntelSnapshot>;
  errors: Record<string, string>;
  isLoading: boolean;
  error: unknown;
} {
  const normalized = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].sort();
  const symKey = normalized.join(",");
  const key: readonly [string, string, ScannerGapIntelBatchMode] | null =
    enabled && symKey ? ([`${STOCVEST_SWR_CACHE_NS}gap-intel-batch`, symKey, mode] as const) : null;

  const { data, error, isLoading } = useSWR(
    key,
    async ([, joined, md]: readonly [string, string, ScannerGapIntelBatchMode]) => {
      const list = joined ? joined.split(",") : [];
      const res = await fetch("/api/stocvest/signals/gap-intel/batch", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbols: list, trading_mode: md })
      });
      if (!res.ok) {
        throw new Error(`Gap intel batch failed: ${res.status} ${res.statusText}`);
      }
      const raw = (await res.json()) as {
        items?: Record<string, unknown>;
        errors?: Record<string, string>;
      };
      const snapshots: Record<string, GapIntelSnapshot> = {};
      for (const [sym, payload] of Object.entries(raw.items ?? {})) {
        const parsed = parseGapIntelSnapshot(payload);
        if (parsed) snapshots[sym] = parsed;
      }
      return { snapshots, errors: raw.errors ?? {} };
    },
    { dedupingInterval: 30_000 }
  );

  return {
    snapshots: data?.snapshots ?? {},
    errors: data?.errors ?? {},
    isLoading,
    error
  };
}
