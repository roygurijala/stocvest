import type { ScenarioInput } from "@/lib/scenario/types";
import type { SignalsSetupBias } from "@/lib/signals-page-present";
import type { TrackedPlan, TrackedPlanMode } from "@/lib/trade-plan/types";

function biasLabel(bias: SignalsSetupBias): TrackedPlan["bias"] {
  if (bias === "Bullish") return "Bullish";
  if (bias === "Bearish") return "Bearish";
  return "Neutral";
}

export function buildTrackedPlanFromDeepDive(input: {
  symbol: string;
  mode: TrackedPlanMode;
  setupBias: SignalsSetupBias;
  layersAligned?: number | null;
  layersTotal?: number | null;
  scenario: {
    entryLow: number;
    entryHigh: number;
    stopPrice: number;
    target1: number;
    target2?: number | null;
    currentPrice: number;
    displayRr?: number | null;
    entryZoneQuality?: string | null;
  };
  composite?: Record<string, unknown> | null;
  verdictLine?: string | null;
  deskMinRr?: number | null;
}): TrackedPlan {
  const sym = input.symbol.trim().toUpperCase();
  const now = new Date();
  const comp = input.composite ?? null;
  const expiresRaw =
    comp && typeof comp.signal_expires === "string"
      ? comp.signal_expires
      : comp && typeof comp.signal_valid_until === "string"
        ? comp.signal_valid_until
        : null;
  const parameterVersion =
    comp && typeof comp.parameter_version === "string" ? comp.parameter_version : null;

  return {
    id: `${input.mode}:${sym}:${now.getTime()}`,
    symbol: sym,
    mode: input.mode,
    committedAt: now.toISOString(),
    expiresAt: expiresRaw,
    bias: biasLabel(input.setupBias),
    layersAligned: input.layersAligned ?? null,
    layersTotal: input.layersTotal ?? null,
    levels: {
      entryLow: input.scenario.entryLow,
      entryHigh: input.scenario.entryHigh,
      stop: input.scenario.stopPrice,
      target1: input.scenario.target1,
      target2: input.scenario.target2 ?? null,
      priceAtCommit: input.scenario.currentPrice,
      riskRewardAtCommit:
        typeof input.scenario.displayRr === "number" && Number.isFinite(input.scenario.displayRr)
          ? input.scenario.displayRr
          : null
    },
    entryZoneQuality: input.scenario.entryZoneQuality ?? null,
    parameterVersion,
    verdictLine: input.verdictLine?.trim() || null,
    deskMinRr: input.deskMinRr ?? null
  };
}

/** Scenario Builder — freeze reference levels carried on the planning sheet. */
export function buildTrackedPlanFromScenarioInput(
  input: ScenarioInput,
  opts?: { verdictLine?: string | null; deskMinRr?: number | null }
): TrackedPlan | null {
  const ref = input.reference;
  const entryLow = ref.entry_low;
  const entryHigh = ref.entry_high;
  const stop = ref.stop;
  const target1 = ref.target_1;
  const price = ref.current_price;
  if (
    entryLow == null ||
    entryHigh == null ||
    stop == null ||
    target1 == null ||
    price == null ||
    !Number.isFinite(entryLow) ||
    !Number.isFinite(entryHigh) ||
    !Number.isFinite(stop) ||
    !Number.isFinite(target1) ||
    !Number.isFinite(price)
  ) {
    return null;
  }
  const bias: SignalsSetupBias =
    input.direction === "bullish" ? "Bullish" : input.direction === "bearish" ? "Bearish" : "Neutral";
  return buildTrackedPlanFromDeepDive({
    symbol: input.symbol,
    mode: input.mode,
    setupBias: bias,
    scenario: {
      entryLow,
      entryHigh,
      stopPrice: stop,
      target1,
      target2: ref.target_2 ?? null,
      currentPrice: price,
      displayRr: input.risk_reward ?? null,
      entryZoneQuality: null
    },
    composite: {
      signal_expires: input.expires_at ?? undefined,
      parameter_version: undefined
    },
    verdictLine: opts?.verdictLine ?? null,
    deskMinRr: opts?.deskMinRr ?? null
  });
}
