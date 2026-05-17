/**
 * Signals page — evaluation freshness copy and composite timestamp helpers.
 */

import { formatLastEvaluatedShort } from "@/lib/watchlist-evaluation-present";

export const SIGNALS_UPDATE_MICROCOPY =
  "Signals update when you open a symbol, refresh this page, or after the scheduled desk evaluation.";

const DEFAULT_JUST_NOW_MS = 90_000;

export function extractCompositeGeneratedAt(
  composite: Record<string, unknown> | null | undefined
): string | null {
  if (!composite) return null;
  const gen = composite.generated_at;
  if (typeof gen === "string" && gen.trim()) return gen.trim();
  const ts = composite.timestamp_iso;
  if (typeof ts === "string" && ts.trim()) return ts.trim();
  return null;
}

export type SignalEvaluationFreshnessPhase = "loading" | "refreshing" | "ready";

export type SignalEvaluationFreshness = {
  phase: SignalEvaluationFreshnessPhase;
  /** User-visible line under the symbol (e.g. "Evaluated just now"). */
  label: string;
};

export function formatSignalEvaluationFreshness(
  generatedAtIso: string | null,
  opts?: { now?: number; justNowThresholdMs?: number }
): string {
  if (!generatedAtIso) return "Evaluating…";
  const t = Date.parse(generatedAtIso);
  if (Number.isNaN(t)) return "Evaluating…";
  const now = opts?.now ?? Date.now();
  const threshold = opts?.justNowThresholdMs ?? DEFAULT_JUST_NOW_MS;
  if (now - t < threshold) return "Evaluated just now";
  const short = formatLastEvaluatedShort(generatedAtIso);
  return short ? `Last evaluated: ${short}` : "Evaluated";
}

export function buildSignalEvaluationFreshness(args: {
  symbolCommitted: boolean;
  tab: "layers" | "history";
  isInitialLoading: boolean;
  isRevalidating: boolean;
  isMountRevalidating: boolean;
  composite: Record<string, unknown> | null;
  isInsufficient: boolean;
}): SignalEvaluationFreshness | null {
  if (!args.symbolCommitted || args.tab !== "layers") return null;

  const loading =
    args.isInitialLoading ||
    args.isMountRevalidating ||
    (args.isRevalidating && args.composite == null);

  if (loading) {
    return {
      phase: args.isMountRevalidating || args.isRevalidating ? "refreshing" : "loading",
      label: "Refreshing latest market state…"
    };
  }

  if (args.isRevalidating) {
    return {
      phase: "refreshing",
      label: "Refreshing latest market state…"
    };
  }

  if (!args.composite || args.isInsufficient) {
    return { phase: "ready", label: "Evaluation pending" };
  }

  const generatedAt = extractCompositeGeneratedAt(args.composite);
  return {
    phase: "ready",
    label: formatSignalEvaluationFreshness(generatedAt)
  };
}
