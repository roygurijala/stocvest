import type { GapIntelSnapshot } from "@/lib/api/gap-intel";
import type { SnapshotPayload } from "@/lib/api/market";
import { parseSwingCompositeInsight } from "@/lib/signal-evidence";
import type { SignalsSetupBias } from "@/lib/signals-page-present";
import type { ScenarioInput, ScenarioMode, VolatilityRegime } from "@/lib/scenario/types";

function gapIntelStructuralBanner(reasons: readonly string[]): string | null {
  if (!reasons.length) return null;
  const r = reasons[0] ?? "";
  const map: Record<string, string> = {
    swing_premarket_planning_only:
      "Pre-market planning only — confirmation requires regular-session participation.",
    day_open_phase_volatility:
      "Open-phase volatility: early prints can reverse; risk framework may be unstable until 10:30 ET.",
    swing_after_hours_next_session_only:
      "After-hours planning only — confirm during the next regular session.",
    day_planning_requires_rth_structure: "Day-mode drafting requires regular-session structure.",
    day_after_hours_no_rth_context: "Day-mode drafting is unavailable after regular session."
  };
  return map[r] ?? "Planning-only context — confirm when regular-session data is available.";
}

/** Map composite / evidence market_regime strings to Scenario Builder volatility. */
export function marketRegimeToVolatilityRegime(label: string | null | undefined): VolatilityRegime {
  const norm = (label ?? "").trim().toLowerCase();
  if (!norm) return "unknown";
  if (norm.includes("risk_on") || norm === "risk-on" || norm.includes("low")) return "low";
  if (norm.includes("neutral") || norm.includes("normal")) return "normal";
  if (norm.includes("risk_off") || norm === "risk-off" || norm.includes("elevated")) return "elevated";
  if (norm.includes("avoid") || norm.includes("extreme")) return "extreme";
  return "unknown";
}

/** Scanner dashboard regime label → volatility regime. */
export function overviewRegimeToVolatilityRegime(label: string | null | undefined): VolatilityRegime {
  const norm = (label ?? "").trim().toLowerCase();
  if (!norm) return "unknown";
  if (norm.includes("low") || norm.includes("calm")) return "low";
  if (norm.includes("normal") || norm.includes("moderate")) return "normal";
  if (norm.includes("elevated") || norm.includes("high")) return "elevated";
  if (norm.includes("extreme") || norm.includes("volatile")) return "extreme";
  return "normal";
}

export function augmentScenarioInputWithGapIntel(
  input: ScenarioInput,
  snap: GapIntelSnapshot | null | undefined
): ScenarioInput {
  if (!snap) return input;
  const st = snap.scenario_builder.state;
  const reasons = snap.scenario_builder.reasons ?? [];
  if (st === "DISABLED") {
    return { ...input, gap_intel_gate: { scenario_builder_state: "DISABLED", reasons } };
  }
  if (st === "LIMITED") {
    const b = gapIntelStructuralBanner(reasons);
    return b ? { ...input, structural_planning_banner: b } : input;
  }
  return input;
}

export function setupBiasToScenarioDirection(bias: SignalsSetupBias): ScenarioInput["direction"] {
  if (bias === "Bullish") return "bullish";
  if (bias === "Bearish") return "bearish";
  return "neutral";
}

export function buildScenarioInputFromEvidenceParts(parts: {
  symbol: string;
  direction: "bullish" | "bearish" | "neutral";
  mode: ScenarioMode;
  generatedAt?: string | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  stop?: number | null;
  target1?: number | null;
  target2?: number | null;
  currentPrice?: number | null;
  prevClose?: number | null;
  marketRegime?: string | null;
  riskReward?: number | null;
  directionBadgeLabel?: string | null;
}): ScenarioInput {
  return {
    symbol: parts.symbol.trim().toUpperCase(),
    direction: parts.direction,
    mode: parts.mode,
    generated_at: parts.generatedAt ?? null,
    reference: {
      entry_low: parts.entryLow ?? null,
      entry_high: parts.entryHigh ?? null,
      stop: parts.stop ?? null,
      target_1: parts.target1 ?? null,
      target_2: parts.target2 ?? null,
      current_price: parts.currentPrice ?? null,
      prev_close: parts.prevClose ?? null
    },
    volatility_regime: marketRegimeToVolatilityRegime(parts.marketRegime),
    risk_reward:
      typeof parts.riskReward === "number" && Number.isFinite(parts.riskReward) ? parts.riskReward : null,
    tags: parts.directionBadgeLabel?.trim() ? [parts.directionBadgeLabel.trim()] : undefined
  };
}

/** Signals page / composite-backed surfaces. */
export function buildScenarioInputFromCompositeContext(args: {
  symbol: string;
  tradingMode: "day" | "swing";
  setupBias: SignalsSetupBias;
  composite: Record<string, unknown> | null | undefined;
  snapshot?: SnapshotPayload | null;
}): ScenarioInput {
  const sym = args.symbol.trim().toUpperCase();
  const insight = args.composite ? parseSwingCompositeInsight(args.composite) : null;
  const zone = insight?.historical_entry_zone;
  const last =
    typeof args.snapshot?.last_trade_price === "number" && Number.isFinite(args.snapshot.last_trade_price)
      ? args.snapshot.last_trade_price
      : null;
  const prevClose =
    typeof args.snapshot?.prev_close === "number" && Number.isFinite(args.snapshot.prev_close)
      ? args.snapshot.prev_close
      : null;
  const generated =
    typeof args.composite?.generated_at === "string"
      ? args.composite.generated_at
      : typeof args.composite?.timestamp_iso === "string"
        ? args.composite.timestamp_iso
        : null;
  return {
    symbol: sym,
    direction: setupBiasToScenarioDirection(args.setupBias),
    mode: args.tradingMode,
    generated_at: generated,
    reference: {
      entry_low: zone?.low ?? null,
      entry_high: zone?.high ?? null,
      stop: insight?.reference_stop_level ?? null,
      target_1: insight?.reference_target_1 ?? null,
      target_2: insight?.reference_target_2 ?? null,
      current_price: last,
      prev_close: prevClose
    },
    volatility_regime: marketRegimeToVolatilityRegime(insight?.market_regime ?? null),
    risk_reward:
      typeof insight?.risk_reward === "number" && Number.isFinite(insight.risk_reward)
        ? insight.risk_reward
        : null
  };
}

/** Watchlist row — best-effort from snapshot quote; often ineligible until Signals evidence is run. */
export function buildWatchlistScenarioInput(args: {
  symbol: string;
  mode: "day" | "swing";
  snapshot?: SnapshotPayload;
  quoteBullish?: boolean | null;
}): ScenarioInput {
  const sym = args.symbol.trim().toUpperCase();
  const direction =
    args.quoteBullish === true ? "bullish" : args.quoteBullish === false ? "bearish" : "neutral";
  const last = args.snapshot?.last_trade_price;
  const current =
    typeof last === "number" && Number.isFinite(last) && last > 0 ? last : null;
  const stop =
    typeof args.snapshot?.day_low === "number" && Number.isFinite(args.snapshot.day_low) && args.snapshot.day_low > 0
      ? args.snapshot.day_low
      : null;
  return {
    symbol: sym,
    direction,
    mode: args.mode,
    reference: { current_price: current, stop },
    volatility_regime: "normal"
  };
}
