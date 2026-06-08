/**
 * Layer 0 market environment (VIX tier) — mirrors API `market_environment`.
 */

import { minRiskRewardForVerdict } from "@/lib/trade-conviction-tier";

export type EnvironmentTier = "normal" | "elevated" | "stressed" | "crisis";
export type TargetPolicy = "t1_and_t2" | "t1_preferred" | "t1_only";

export type MarketEnvironmentPayload = {
  policy_version: string;
  environment_tier: EnvironmentTier;
  /** Instantaneous tier before hysteresis (v2). */
  environment_tier_raw?: EnvironmentTier;
  hysteresis_applied?: boolean;
  vix_level: number | null;
  vix_direction: string;
  vix_change_pct: number | null;
  vix_change_5d_pct?: number | null;
  macro_regime: string;
  mode: "day" | "swing";
  new_swing_allowed: boolean;
  new_day_allowed: boolean;
  min_rr_swing: number;
  min_rr_day: number;
  min_rr: number;
  target_policy: TargetPolicy;
  size_guidance: string;
  headline: string;
  ledger_environment_pass: boolean;
};

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function tierOrDefault(v: unknown): EnvironmentTier {
  const t = String(v ?? "normal").trim().toLowerCase();
  if (t === "elevated" || t === "stressed" || t === "crisis") return t;
  return "normal";
}

export function parseMarketEnvironment(body: Record<string, unknown>): MarketEnvironmentPayload | null {
  const raw = body.market_environment;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const headline = String(o.headline ?? "").trim();
  if (!headline) return null;
  const rawTier = o.environment_tier_raw != null ? tierOrDefault(o.environment_tier_raw) : undefined;
  return {
    policy_version: String(o.policy_version ?? "env_policy_v1"),
    environment_tier: tierOrDefault(o.environment_tier),
    environment_tier_raw: rawTier,
    hysteresis_applied: Boolean(o.hysteresis_applied),
    vix_level: numOrNull(o.vix_level),
    vix_direction: String(o.vix_direction ?? "flat"),
    vix_change_pct: numOrNull(o.vix_change_pct),
    vix_change_5d_pct: numOrNull(o.vix_change_5d_pct),
    macro_regime: String(o.macro_regime ?? "neutral"),
    mode: String(o.mode ?? "swing") === "day" ? "day" : "swing",
    new_swing_allowed: Boolean(o.new_swing_allowed ?? true),
    new_day_allowed: Boolean(o.new_day_allowed ?? true),
    min_rr_swing: numOrNull(o.min_rr_swing) ?? 2,
    min_rr_day: numOrNull(o.min_rr_day) ?? 1.3,
    min_rr: numOrNull(o.min_rr) ?? 2,
    target_policy: (String(o.target_policy ?? "t1_and_t2") as TargetPolicy) || "t1_and_t2",
    size_guidance: String(o.size_guidance ?? "full"),
    headline,
    ledger_environment_pass: Boolean(o.ledger_environment_pass ?? true)
  };
}

export function environmentTierLabel(tier: EnvironmentTier): string {
  switch (tier) {
    case "crisis":
      return "Crisis";
    case "stressed":
      return "Stressed";
    case "elevated":
      return "Elevated";
    default:
      return "Normal";
  }
}

/** Desk min R/R for planning UI — prefers VIX-tier policy from composite, else static baseline. */
export function minRrForDeskMode(
  environment: MarketEnvironmentPayload | null | undefined,
  mode: "day" | "swing"
): number {
  if (environment) {
    const modeKey = mode === "day" ? environment.min_rr_day : environment.min_rr_swing;
    if (Number.isFinite(modeKey) && modeKey > 0) return modeKey;
    if (Number.isFinite(environment.min_rr) && environment.min_rr > 0) return environment.min_rr;
  }
  return minRiskRewardForVerdict(mode);
}
