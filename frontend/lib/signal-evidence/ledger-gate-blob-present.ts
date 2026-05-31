/**
 * Parse persisted ledger `gate_status` JSON (Dynamo `gate_status_json`).
 *
 * Shape: `{ qualified, gates, market_environment_audit?, execution_quality? }`
 * Composite live responses use a flat `gates` dict only — see `ledger-gate-present.ts`.
 */

import type { LedgerGateSummary } from "@/lib/signal-evidence/ledger-gate-present";
import { parseLedgerGateSummary } from "@/lib/signal-evidence/ledger-gate-present";

export type MarketEnvironmentAudit = {
  policy_version: string;
  environment_tier: string;
  environment_tier_raw?: string;
  hysteresis_applied?: boolean;
  vix_level: number | null;
  vix_change_5d_pct?: number | null;
  min_rr_swing?: number | null;
  min_rr_day?: number | null;
  target_policy?: string | null;
};

export type ParsedLedgerGateBlob = {
  qualified: boolean | null;
  gates: LedgerGateSummary | null;
  marketEnvironmentAudit: MarketEnvironmentAudit | null;
};

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export function parseMarketEnvironmentAudit(raw: unknown): MarketEnvironmentAudit | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tier = String(o.environment_tier ?? "").trim().toLowerCase();
  if (!tier) return null;
  return {
    policy_version: String(o.policy_version ?? ""),
    environment_tier: tier,
    environment_tier_raw:
      typeof o.environment_tier_raw === "string" ? o.environment_tier_raw : undefined,
    hysteresis_applied: Boolean(o.hysteresis_applied),
    vix_level: numOrNull(o.vix_level),
    vix_change_5d_pct: numOrNull(o.vix_change_5d_pct),
    min_rr_swing: numOrNull(o.min_rr_swing),
    min_rr_day: numOrNull(o.min_rr_day),
    target_policy: typeof o.target_policy === "string" ? o.target_policy : null
  };
}

export function environmentTierDisplayLabel(tier: string): string {
  switch (tier) {
    case "crisis":
      return "Crisis";
    case "stressed":
      return "Stressed";
    case "elevated":
      return "Elevated";
    case "normal":
      return "Normal";
    default:
      return "Unknown";
  }
}

/** One-line audit for tables (performance / admin). */
export function formatEnvironmentAuditLine(audit: MarketEnvironmentAudit | null): string | null {
  if (!audit) return null;
  const label = environmentTierDisplayLabel(audit.environment_tier);
  const vix =
    audit.vix_level != null && Number.isFinite(audit.vix_level)
      ? ` · VIX ${audit.vix_level.toFixed(1)}`
      : "";
  const held =
    audit.hysteresis_applied &&
    audit.environment_tier_raw &&
    audit.environment_tier_raw !== audit.environment_tier
      ? ` (held vs ${audit.environment_tier_raw})`
      : "";
  return `${label}${vix}${held}`;
}

export function parseLedgerGateBlob(gateStatus: unknown): ParsedLedgerGateBlob | null {
  if (!gateStatus || typeof gateStatus !== "object") return null;
  const blob = gateStatus as Record<string, unknown>;

  if ("gates" in blob && typeof blob.gates === "object" && blob.gates !== null) {
    const qualified =
      typeof blob.qualified === "boolean"
        ? blob.qualified
        : typeof blob.ledger_qualified === "boolean"
          ? blob.ledger_qualified
          : null;
    const gates = parseLedgerGateSummary({
      gate_status: blob.gates as Record<string, unknown>,
      ledger_qualified: qualified ?? undefined
    });
    return {
      qualified,
      gates,
      marketEnvironmentAudit: parseMarketEnvironmentAudit(blob.market_environment_audit)
    };
  }

  const gatesOnly = parseLedgerGateSummary({ gate_status: blob });
  if (!gatesOnly) return null;
  return {
    qualified: gatesOnly.qualified,
    gates: gatesOnly,
    marketEnvironmentAudit: null
  };
}
