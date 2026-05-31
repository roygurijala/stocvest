/**
 * Four-layer risk stack (Environment → Signal → Plan → Ledger) for Evidence UI.
 */

import type { LedgerGateSummary } from "@/lib/signal-evidence/ledger-gate-present";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import type { SignalEvidenceInsight } from "@/lib/signal-evidence";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";

export type RiskStackStatus = "pass" | "warn" | "fail";

export type RiskStackRow = {
  layer: "environment" | "signal" | "plan" | "ledger";
  label: string;
  status: RiskStackStatus;
  summary: string;
  detail?: string;
};

export type RiskStackSummary = {
  rows: RiskStackRow[];
  /** Actionable signal while environment blocks new ledger entries. */
  environmentBlocksLedger: boolean;
  decouplingMessage: string | null;
};

function statusDotColor(status: RiskStackStatus): "bullish" | "caution" | "bearish" {
  if (status === "pass") return "bullish";
  if (status === "warn") return "caution";
  return "bearish";
}

export function riskStackStatusColor(status: RiskStackStatus): "bullish" | "caution" | "bearish" {
  return statusDotColor(status);
}

function signalLabel(state: TradeDecisionState): string {
  if (state === "actionable") return "Actionable";
  if (state === "blocked") return "Blocked";
  return "Monitor";
}

export function buildRiskStackSummary(args: {
  environment: MarketEnvironmentPayload;
  signalState: TradeDecisionState;
  insight: SignalEvidenceInsight | null;
  ledgerGates: LedgerGateSummary | null;
}): RiskStackSummary {
  const { environment, signalState, insight, ledgerGates } = args;
  const mode = environment.mode;
  const newEntriesAllowed = mode === "day" ? environment.new_day_allowed : environment.new_swing_allowed;
  const minRr = environment.min_rr;

  const envStatus: RiskStackStatus = newEntriesAllowed ? "pass" : "fail";
  const envSummary = newEntriesAllowed
    ? `${environmentTierShort(environment.environment_tier)} — new ${mode} entries allowed (min R/R ${minRr.toFixed(1)}:1)`
    : `${environmentTierShort(environment.environment_tier)} — new ${mode} validation entries paused`;

  const signalStatus: RiskStackStatus =
    signalState === "actionable" ? "pass" : signalState === "monitor" ? "warn" : "fail";

  const rr = insight?.risk_reward;
  const rrFinite = typeof rr === "number" && Number.isFinite(rr);
  const rrPass = rrFinite && rr >= minRr;
  const hasStop = insight?.reference_stop_level != null;
  const t2Suppressed =
    environment.target_policy === "t1_only" ||
    (insight?.reference_target_2 == null &&
      Boolean(insight?.reference_target_provenance?.toLowerCase().includes("suppress")));

  let planStatus: RiskStackStatus = "pass";
  if (!hasStop || !rrFinite) planStatus = "warn";
  else if (!rrPass) planStatus = "fail";

  const planParts: string[] = [];
  if (hasStop) planParts.push("Stop structure + ATR floor");
  else planParts.push("Stop levels incomplete");
  if (rrFinite) {
    planParts.push(`R/R ${rr.toFixed(1)}:1 vs desk ${minRr.toFixed(1)}:1`);
  } else {
    planParts.push("R/R not computed");
  }
  if (t2Suppressed) planParts.push("T1-only target policy");

  let ledgerStatus: RiskStackStatus = "warn";
  let ledgerSummary = "Ledger gates not evaluated for this view";
  if (ledgerGates) {
    if (ledgerGates.qualified === true) ledgerStatus = "pass";
    else if (ledgerGates.qualified === false) ledgerStatus = "fail";
    else ledgerStatus = "warn";
    const passed = ledgerGates.rows.filter((r) => r.pass).length;
    ledgerSummary =
      ledgerGates.qualified === true
        ? `Qualified — ${passed}/${ledgerGates.rows.length} gates passed`
        : ledgerGates.qualified === false
          ? `Not qualified — ${ledgerGates.rows
              .filter((r) => !r.pass)
              .map((r) => r.label)
              .join(", ")}`
          : `Checklist — ${passed}/${ledgerGates.rows.length} gates passed`;
  } else if (!newEntriesAllowed) {
    ledgerStatus = "fail";
    ledgerSummary = `Would not qualify — environment blocks new ${mode} entries`;
  }

  const environmentBlocksLedger = signalState === "actionable" && !newEntriesAllowed;
  const decouplingMessage = environmentBlocksLedger
    ? `Layers show ${signalLabel(signalState).toLowerCase()} direction; new ${mode} validation entries are paused by the VIX environment. Planning and signal review continue — only ledger logging is gated.`
    : null;

  const rows: RiskStackRow[] = [
    {
      layer: "environment",
      label: "Environment",
      status: envStatus,
      summary: envSummary,
      detail: environment.headline
    },
    {
      layer: "signal",
      label: "Signal",
      status: signalStatus,
      summary: `${signalLabel(signalState)} — six-layer direction and score (unchanged by VIX)`,
      detail:
        insight?.alignment_ratio != null && Number.isFinite(insight.alignment_ratio)
          ? `Alignment ${Math.round(insight.alignment_ratio * 100)}%`
          : undefined
    },
    {
      layer: "plan",
      label: "Plan",
      status: planStatus,
      summary: planParts.join(" · "),
      detail: insight?.reference_stop_provenance ?? undefined
    },
    {
      layer: "ledger",
      label: "Ledger",
      status: ledgerStatus,
      summary: ledgerSummary
    }
  ];

  return { rows, environmentBlocksLedger, decouplingMessage };
}

function environmentTierShort(tier: MarketEnvironmentPayload["environment_tier"]): string {
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

export function parseApiDecisionState(raw: unknown): TradeDecisionState | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "actionable" || s === "monitor" || s === "blocked") return s;
  return null;
}
