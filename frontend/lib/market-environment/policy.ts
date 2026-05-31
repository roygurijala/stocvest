/**
 * Client-side market environment policy (keep thresholds in sync with
 * `stocvest/api/services/market_environment.py`).
 */

import {
  environmentTierLabel,
  parseMarketEnvironment,
  type MarketEnvironmentPayload
} from "@/lib/signal-evidence/market-environment-present";

export const ENVIRONMENT_POLICY_VERSION = "env_policy_v2";

const TIER_NORMAL_ENTER = 20;
const TIER_ELEVATED_ENTER = 28;
const TIER_CRISIS_ENTER = 32;
const SPIKE_MIN_VIX = 22;
const SPIKE_CHANGE_PCT = 10;
const SPIKE_5D_MIN_VIX = 20;
const SPIKE_5D_CHANGE_PCT = 12;

export type EnvironmentTier = MarketEnvironmentPayload["environment_tier"];

export function resolveEnvironmentTierRaw(
  vixLevel: number | null,
  vixChangePct?: number | null,
  vixChange5dPct?: number | null
): EnvironmentTier {
  if (vixLevel == null || !Number.isFinite(vixLevel)) return "normal";
  const spikeSession =
    vixChangePct != null &&
    Number.isFinite(vixChangePct) &&
    vixChangePct >= SPIKE_CHANGE_PCT &&
    vixLevel >= SPIKE_MIN_VIX;
  const spike5d =
    vixChange5dPct != null &&
    Number.isFinite(vixChange5dPct) &&
    vixChange5dPct >= SPIKE_5D_CHANGE_PCT &&
    vixLevel >= SPIKE_5D_MIN_VIX;
  const spike = spikeSession || spike5d;
  if (vixLevel >= TIER_CRISIS_ENTER) return "crisis";
  if (vixLevel >= TIER_ELEVATED_ENTER || spike) return "stressed";
  if (vixLevel >= TIER_NORMAL_ENTER) return "elevated";
  return "normal";
}

/** Client fallback — no persisted hysteresis (server pulse/brief is authoritative). */
export function resolveEnvironmentTier(
  vixLevel: number | null,
  vixChangePct?: number | null,
  vixChange5dPct?: number | null
): EnvironmentTier {
  return resolveEnvironmentTierRaw(vixLevel, vixChangePct, vixChange5dPct);
}

export function buildClientMarketEnvironmentPolicy(args: {
  mode: "day" | "swing";
  vixLevel: number | null;
  vixChangePct?: number | null;
  vixChange5dPct?: number | null;
  vixDirection?: string | null;
  macroRegime?: string | null;
}): MarketEnvironmentPayload {
  const tier = resolveEnvironmentTier(args.vixLevel, args.vixChangePct, args.vixChange5dPct);
  const direction = (args.vixDirection ?? "flat").trim().toLowerCase() || "flat";
  const vixStr =
    args.vixLevel != null && Number.isFinite(args.vixLevel) ? args.vixLevel.toFixed(1) : null;

  let headline: string;
  let newSwing = true;
  let newDay = true;
  let minRrSwing = 2;
  let minRrDay = 1.3;
  let targetPolicy: MarketEnvironmentPayload["target_policy"] = "t1_and_t2";
  let sizeGuidance = "full";

  if (tier === "crisis") {
    newSwing = false;
    newDay = false;
    minRrSwing = 3;
    minRrDay = 2;
    targetPolicy = "t1_only";
    sizeGuidance = "minimal";
    headline = vixStr
      ? `Crisis environment (VIX ${vixStr}) — no new swing or day validation entries; plan to T1 only.`
      : "Crisis environment — no new swing or day validation entries; plan to T1 only.";
  } else if (tier === "stressed") {
    newSwing = false;
    newDay = true;
    minRrSwing = 3;
    minRrDay = 1.8;
    targetPolicy = "t1_only";
    sizeGuidance = "reduced";
    headline = vixStr
      ? `Stressed environment (VIX ${vixStr}) — pause new swing entries; day trades need stronger R/R; T1 targets only.`
      : "Stressed environment — pause new swing entries; T1 targets only.";
  } else if (tier === "elevated") {
    minRrSwing = 3;
    minRrDay = 1.8;
    targetPolicy = "t1_preferred";
    sizeGuidance = "reduced";
    headline = vixStr
      ? `Elevated volatility (VIX ${vixStr}) — swing ledger requires ≥3:1 R/R; prefer T1 over T2 extensions.`
      : "Elevated volatility — swing ledger requires ≥3:1 R/R; prefer T1 over T2 extensions.";
  } else {
    headline = vixStr
      ? `Normal environment (VIX ${vixStr}) — standard desk R/R and target rules apply.`
      : "Normal environment — standard desk R/R and target rules apply.";
  }

  const minRr = args.mode === "day" ? minRrDay : minRrSwing;
  const reg = (args.macroRegime ?? "neutral").trim() || "neutral";
  if (reg.toLowerCase() === "avoid") {
    headline = `${headline} Macro regime is AVOID — extra caution.`;
  }

  const chg5 =
    args.vixChange5dPct != null && Number.isFinite(args.vixChange5dPct) ? args.vixChange5dPct : null;
  if (chg5 != null && chg5 >= SPIKE_5D_CHANGE_PCT) {
    headline = `${headline} VIX +${chg5.toFixed(1)}% over ~5 sessions.`;
  }

  return {
    policy_version: ENVIRONMENT_POLICY_VERSION,
    environment_tier: tier,
    environment_tier_raw: tier,
    hysteresis_applied: false,
    vix_level: args.vixLevel,
    vix_direction: direction,
    vix_change_pct: args.vixChangePct ?? null,
    vix_change_5d_pct: chg5,
    macro_regime: reg,
    mode: args.mode,
    new_swing_allowed: newSwing,
    new_day_allowed: newDay,
    min_rr_swing: minRrSwing,
    min_rr_day: minRrDay,
    min_rr: minRr,
    target_policy: targetPolicy,
    size_guidance: sizeGuidance,
    headline,
    ledger_environment_pass: args.mode === "day" ? newDay : newSwing
  };
}

export function parseMarketEnvironmentFromPulse(
  raw: Record<string, unknown> | null | undefined,
  mode: "day" | "swing"
): MarketEnvironmentPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const key = mode === "day" ? "market_environment_day" : "market_environment_swing";
  const nested = raw[key] ?? raw.market_environment;
  if (nested && typeof nested === "object") {
    const parsed = parseMarketEnvironment({ market_environment: nested });
    if (parsed) return parsed;
  }
  const vix = typeof raw.vix_level === "number" && Number.isFinite(raw.vix_level) ? raw.vix_level : null;
  if (vix == null) return null;
  const chg =
    typeof raw.vix_change_pct === "number" && Number.isFinite(raw.vix_change_pct)
      ? raw.vix_change_pct
      : null;
  const chg5 =
    typeof raw.vix_change_5d_pct === "number" && Number.isFinite(raw.vix_change_5d_pct)
      ? raw.vix_change_5d_pct
      : null;
  return buildClientMarketEnvironmentPolicy({
    mode,
    vixLevel: vix,
    vixChangePct: chg,
    vixChange5dPct: chg5,
    macroRegime: typeof raw.regime === "string" ? raw.regime : null
  });
}

export { environmentTierLabel };
