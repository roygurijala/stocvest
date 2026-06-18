/**
 * Setup judgment — quality (layer agreement) vs tradeability (entry geometry).
 * Parsed from composite `setup_judgment` or derived client-side from layers + technical row.
 */

import {
  resolveAlignmentDisplayTier,
  type AlignmentDisplayTier
} from "@/lib/alignment-display-tier";
import {
  layerRowEligibleForAlignmentCount,
  parseCompositeDirectionFields,
  resolveSignalsLayerAlignment,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";

export type SetupPhaseId = "early" | "expansion" | "extended" | "exhaustion";
export type TradeabilityBand = "strong" | "moderate" | "weak";
export type TradeabilityFlagSeverity = "warn" | "block";

export type TradeabilityFlag = {
  id: string;
  label: string;
  severity: TradeabilityFlagSeverity;
};

export type SetupJudgment = {
  process: {
    tier: AlignmentDisplayTier;
    label: string;
    layersAligned: number;
    layersTotal: number;
  };
  setupPhase: { id: SetupPhaseId; label: string } | null;
  tradeability: {
    band: TradeabilityBand;
    label: string;
    flags: TradeabilityFlag[];
  };
  primaryBlocker: string | null;
  watchFor: string | null;
  /** Internal — not for hero UI. */
  engineScores?: { quality: number; tradeability: number };
};

const PROCESS_LABEL: Record<AlignmentDisplayTier, string> = {
  not_aligned: "Not aligned",
  developing: "Developing",
  near_ready: "Near ready",
  actionable: "Strong",
  invalidated: "Invalidated",
  re_evaluating: "Re-evaluating"
};

function reconcileSetupJudgmentProcess(
  judgment: SetupJudgment,
  composite: Record<string, unknown> | null | undefined,
  input: {
    bias: SignalsSetupBias;
    rows: SignalsLayerRowInput[];
    alignmentRatio?: number | null;
  }
): SetupJudgment {
  const dir = parseCompositeDirectionFields(composite ?? undefined);
  const biasAlignment = resolveSignalsLayerAlignment({
    rows: input.rows,
    bias: input.bias,
    alignmentRatio: input.alignmentRatio ?? null,
    compositeDirection: dir
  });
  const layersAligned =
    input.bias === "Neutral" && dir != null ? dir.directional : biasAlignment.aligned;
  const layersTotal = biasAlignment.total;
  const overstatedNeutral =
    input.bias === "Neutral" && judgment.process.layersAligned > layersAligned + 1;
  const drifted =
    Math.abs(judgment.process.layersAligned - layersAligned) > 1 ||
    judgment.process.layersTotal !== layersTotal;
  if (!overstatedNeutral && !drifted) return judgment;

  const tier = resolveAlignmentDisplayTier({
    layersAligned,
    layersTotal
  });
  return {
    ...judgment,
    process: {
      tier,
      label: PROCESS_LABEL[tier],
      layersAligned,
      layersTotal
    }
  };
}

const PHASE_LABEL: Record<SetupPhaseId, string> = {
  early: "Early",
  expansion: "Expansion",
  extended: "Extended",
  exhaustion: "Exhaustion"
};

const TRADEABILITY_LABEL: Record<TradeabilityBand, string> = {
  strong: "Strong entry timing",
  moderate: "Moderate entry timing",
  weak: "Weak entry timing"
};

function parsePhase(raw: unknown): { id: SetupPhaseId; label: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const id = String((raw as { id?: string }).id || "").trim() as SetupPhaseId;
  if (!["early", "expansion", "extended", "exhaustion"].includes(id)) return null;
  const label = String((raw as { label?: string }).label || PHASE_LABEL[id]);
  return { id, label };
}

function parseFlags(raw: unknown): TradeabilityFlag[] {
  if (!Array.isArray(raw)) return [];
  const out: TradeabilityFlag[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const id = String((row as { id?: string }).id || "").trim();
    const label = String((row as { label?: string }).label || "").trim();
    const sev = String((row as { severity?: string }).severity || "warn");
    if (!id || !label) continue;
    out.push({
      id,
      label,
      severity: sev === "block" ? "block" : "warn"
    });
  }
  return out;
}

export function parseSetupJudgment(body: unknown): SetupJudgment | null {
  if (!body || typeof body !== "object") return null;
  const root = (body as { setup_judgment?: unknown }).setup_judgment ?? body;
  if (!root || typeof root !== "object") return null;
  const proc = (root as { process?: unknown }).process;
  if (!proc || typeof proc !== "object") return null;
  const aligned = Number((proc as { layers_aligned?: number }).layers_aligned);
  const total = Number((proc as { layers_total?: number }).layers_total) || 6;
  if (!Number.isFinite(aligned)) return null;
  const tierRaw = String((proc as { tier?: string }).tier || "").trim();
  const tier = resolveAlignmentDisplayTier({
    layersAligned: aligned,
    layersTotal: total,
    maturationState: tierRaw === "actionable" ? "actionable" : null
  });
  const trade = (root as { tradeability?: unknown }).tradeability;
  const band = String((trade as { band?: string } | undefined)?.band || "moderate") as TradeabilityBand;
  const safeBand: TradeabilityBand =
    band === "strong" || band === "weak" || band === "moderate" ? band : "moderate";
  const engine = (root as { engine_scores?: unknown }).engine_scores;
  let engineScores: SetupJudgment["engineScores"];
  if (engine && typeof engine === "object") {
    const q = Number((engine as { quality?: number }).quality);
    const t = Number((engine as { tradeability?: number }).tradeability);
    if (Number.isFinite(q) && Number.isFinite(t)) {
      engineScores = { quality: q, tradeability: t };
    }
  }
  return {
    process: {
      tier,
      label: String((proc as { label?: string }).label || PROCESS_LABEL[tier]),
      layersAligned: Math.round(aligned),
      layersTotal: total
    },
    setupPhase: parsePhase((root as { setup_phase?: unknown }).setup_phase),
    tradeability: {
      band: safeBand,
      label: String((trade as { label?: string } | undefined)?.label || TRADEABILITY_LABEL[safeBand]),
      flags: parseFlags((trade as { flags?: unknown } | undefined)?.flags)
    },
    primaryBlocker: String((root as { primary_blocker?: string }).primary_blocker || "").trim() || null,
    watchFor: String((root as { watch_for?: string }).watch_for || "").trim() || null,
    engineScores
  };
}

function layerSupportsBias(row: SignalsLayerRowInput, bias: SignalsSetupBias): boolean {
  if (!layerRowEligibleForAlignmentCount(row)) return false;
  if (bias === "Bullish") return row.status === "Bullish";
  if (bias === "Bearish") return row.status === "Bearish";
  return row.status === "Bullish" || row.status === "Bearish";
}

function derivePhaseFromTechnicalReasoning(reasoning: string, mode: "swing" | "day"): SetupPhaseId | null {
  const m = reasoning.match(/RSI\s+(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const rsi = Number(m[1]);
  if (!Number.isFinite(rsi)) return null;
  if (mode === "swing") {
    if (rsi >= 80) return "exhaustion";
    if (rsi >= 70) return "extended";
    if (rsi >= 60) return "expansion";
    return "early";
  }
  if (rsi >= 75) return "exhaustion";
  if (rsi >= 65) return "extended";
  if (rsi >= 55) return "expansion";
  return "early";
}

function deriveFlagsFromTechnical(
  reasoning: string,
  mode: "swing" | "day"
): TradeabilityFlag[] {
  const flags: TradeabilityFlag[] = [];
  const rsiM = reasoning.match(/RSI\s+(\d+(?:\.\d+)?)/i);
  if (rsiM) {
    const rsi = Number(rsiM[1]);
    if (Number.isFinite(rsi)) {
      if (mode === "swing" && rsi >= 80) {
        flags.push({ id: "rsi_exhaustion", label: `RSI ${Math.round(rsi)} — exhaustion zone`, severity: "block" });
      } else if ((mode === "swing" && rsi >= 76) || (mode === "day" && rsi >= 75)) {
        flags.push({ id: "rsi_extended", label: `RSI ${Math.round(rsi)} — extended`, severity: "block" });
      } else if (rsi >= 70) {
        flags.push({ id: "rsi_extended", label: `RSI ${Math.round(rsi)} — extended momentum`, severity: "warn" });
      }
    }
  }
  const extM = reasoning.match(/(\d+(?:\.\d+)?)%\s+above\s+SMA50/i);
  if (extM) {
    const pct = Number(extM[1]);
    if (pct >= 15) {
      flags.push({
        id: "above_sma50",
        label: `Price ${pct.toFixed(0)}% above SMA50 — stretched vs mean`,
        severity: pct >= 19 ? "block" : "warn"
      });
    }
  }
  const atrM = reasoning.match(/~(\d+(?:\.\d+)?)×\s*ATR/i);
  if (atrM && Number(atrM[1]) >= 2) {
    flags.push({
      id: "session_move_2x_atr",
      label: `Session move ~${atrM[1]}× ATR — late for fresh entry`,
      severity: "block"
    });
  }
  return flags;
}

function tradeabilityScore(flags: TradeabilityFlag[], phase: SetupPhaseId | null): number {
  let score = 100;
  for (const f of flags) {
    score -= f.severity === "block" ? 25 : 12;
  }
  if (phase === "extended") score -= 10;
  else if (phase === "exhaustion") score -= 20;
  else if (phase === "early") score += 5;
  return Math.max(0, Math.min(100, score));
}

function tradeabilityBand(score: number, flags: TradeabilityFlag[]): TradeabilityBand {
  if (flags.some((f) => f.severity === "block") || score < 40) return "weak";
  if (score >= 70) return "strong";
  return "moderate";
}

/** Client fallback when API has not yet returned `setup_judgment`. */
export function deriveSetupJudgment(input: {
  mode: "swing" | "day";
  rows: SignalsLayerRowInput[];
  bias: SignalsSetupBias;
  alignmentRatio?: number | null;
  technicalReasoning?: string | null;
  unlockWatchFor?: string | null;
}): SetupJudgment {
  const alignment = resolveSignalsLayerAlignment({
    rows: input.rows,
    bias: input.bias,
    alignmentRatio: input.alignmentRatio ?? null
  });
  const tier = resolveAlignmentDisplayTier({
    layersAligned: alignment.aligned,
    layersTotal: alignment.total
  });
  const missing = input.rows
    .filter((r) => layerRowEligibleForAlignmentCount(r) && !layerSupportsBias(r, input.bias))
    .map((r) => r.name);
  const reasoning = (input.technicalReasoning || "").trim();
  const phase = reasoning ? derivePhaseFromTechnicalReasoning(reasoning, input.mode) : null;
  const flags = reasoning ? deriveFlagsFromTechnical(reasoning, input.mode) : [];
  const tScore = tradeabilityScore(flags, phase);
  const band = tradeabilityBand(tScore, flags);
  const primaryBlocker =
    flags.find((f) => f.severity === "block")?.label ??
    (missing.length > 0 ? `Key checks still disagree: ${missing.slice(0, 3).join(", ")}` : null) ??
    flags.find((f) => f.severity === "warn")?.label ??
    null;
  const watchFor =
    input.unlockWatchFor?.trim() ||
    (flags.find((f) => f.severity === "block")
      ? `What must change next: ${flags.find((f) => f.severity === "block")!.label.toLowerCase()}`
      : missing.length > 0
        ? `What must change next: ${missing[0]} needs to align with setup bias`
        : null);
  const qualityBase = Math.round((100 * alignment.aligned) / Math.max(1, alignment.total));
  const ar =
    input.alignmentRatio != null && Number.isFinite(input.alignmentRatio)
      ? Math.round(Math.max(0, Math.min(1, input.alignmentRatio)) * 100)
      : null;
  const quality = ar != null ? Math.round(0.72 * qualityBase + 0.28 * ar) : qualityBase;

  return {
    process: {
      tier,
      label: PROCESS_LABEL[tier],
      layersAligned: alignment.aligned,
      layersTotal: alignment.total
    },
    setupPhase: phase ? { id: phase, label: PHASE_LABEL[phase] } : null,
    tradeability: {
      band,
      label: TRADEABILITY_LABEL[band],
      flags
    },
    primaryBlocker,
    watchFor,
    engineScores: { quality, tradeability: tScore }
  };
}

export function resolveSetupJudgmentFromComposite(
  composite: Record<string, unknown> | null | undefined,
  input: {
    mode: "swing" | "day";
    rows: SignalsLayerRowInput[];
    bias: SignalsSetupBias;
    alignmentRatio?: number | null;
  }
): SetupJudgment | null {
  const parsed = parseSetupJudgment(composite);
  const layers = Array.isArray(composite?.layers) ? (composite!.layers as Record<string, unknown>[]) : [];
  const tech = layers.find((r) => String(r.layer || "").toLowerCase() === "technical");
  const reasoning = tech ? String(tech.reasoning || "") : "";
  const unlock = Array.isArray(composite?.unlock_forecast)
    ? String(
        (
          (composite!.unlock_forecast as Record<string, unknown>[]).find(
            (h) => h.is_primary_blocker
          ) ?? (composite!.unlock_forecast as Record<string, unknown>[])[0]
        )?.trigger_condition || ""
      )
    : null;
  const derived =
    parsed ??
    deriveSetupJudgment({
      mode: input.mode,
      rows: input.rows,
      bias: input.bias,
      alignmentRatio: input.alignmentRatio ?? null,
      technicalReasoning: reasoning,
      unlockWatchFor: unlock || null
    });
  return reconcileSetupJudgmentProcess(derived, composite ?? undefined, input);
}

/** Layer dots for list ranking (e.g. scanner). */
export function formatLayerProgressDots(aligned: number, total: number): string {
  const a = Math.max(0, Math.min(total, aligned));
  return `${"●".repeat(a)}${"○".repeat(Math.max(0, total - a))}`;
}

export function qualityBandFromAligned(aligned: number, total: number): "high" | "medium" | "low" {
  const pct = aligned / Math.max(1, total);
  if (pct >= 5 / 6) return "high";
  if (pct >= 2 / 3) return "medium";
  return "low";
}
