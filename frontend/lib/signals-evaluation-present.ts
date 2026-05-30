/**
 * Signals page — evaluation freshness copy and composite timestamp helpers.
 */

import {
  MATURATION_SESSION_DAY_LINE,
  MATURATION_SESSION_SWING_LINE
} from "@/lib/maturation-expected-frequency";
import { formatLastEvaluatedShort } from "@/lib/watchlist-evaluation-present";

export const SIGNALS_UPDATE_MICROCOPY =
  "Signals update when you open a symbol, refresh this page, or when Dashboard / Watchlists run session refresh.";

/** Full cadence + evaluation copy for the Signals command-bar ⓘ tooltip. */
export function signalsDeskModeTooltip(mode: "day" | "swing"): string {
  const structure =
    mode === "day"
      ? "Evaluated on live session structure · valid through regular session close."
      : "Evaluated on daily close · horizon ~5 calendar days.";
  return [
    structure,
    MATURATION_SESSION_SWING_LINE,
    MATURATION_SESSION_DAY_LINE,
    SIGNALS_UPDATE_MICROCOPY
  ].join("\n\n");
}

/** Inline segment after "Mode: Day ·" (no leading "Mode"). */
export function formatSignalsModeEvaluatedSegment(
  freshness: SignalEvaluationFreshness | null
): string {
  if (!freshness) return "";
  const raw = freshness.label.trim();
  if (/^refreshing/i.test(raw) || /^evaluating/i.test(raw)) return raw;
  if (/^evaluated just now$/i.test(raw)) return "Last evaluated just now";
  if (/^last evaluated:/i.test(raw)) return raw.replace(/^last evaluated:\s*/i, "Last evaluated ");
  if (/^evaluation pending$/i.test(raw)) return "Evaluation pending";
  return raw;
}

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
  isInitialLoading: boolean;
  isRevalidating: boolean;
  isMountRevalidating: boolean;
  composite: Record<string, unknown> | null;
  isInsufficient: boolean;
}): SignalEvaluationFreshness | null {
  if (!args.symbolCommitted) return null;

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
