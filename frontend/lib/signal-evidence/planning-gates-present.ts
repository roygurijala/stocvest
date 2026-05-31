/**
 * Soft Layer 4 planning checklist — informational only (mirrors API `planning_gates`).
 */

import type { ExecutionQualityPayload } from "@/lib/signal-evidence/execution-quality";
import type { SetupJudgment } from "@/lib/signal-evidence/setup-judgment";
import { PRESET_MAX_RISK_PCT } from "@/lib/scenario/planning-risk-present";
import { REFERENCE_STOP_ATR_K_BY_PRESET } from "@/lib/scenario/reference-stop-resolve";
import { minRiskRewardForVerdict } from "@/lib/trade-conviction-tier";

export type PlanningGateCheck = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

export type PlanningGatesPayload = {
  disclaimer: string;
  regime_tag: string;
  preset_fit: Record<string, string>;
  risk_cap_pct: Record<string, number>;
  atr_k_by_preset: Record<string, number>;
  min_rr_desk?: number;
  environment_tier?: string | null;
  checks: PlanningGateCheck[];
  all_favorable: boolean;
  summary: string;
};

const DISCLAIMER =
  "Planning context summarizes desk readiness. Market environment tier affects validation ledger gates; it does not change actionable verdicts or layer scores.";

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export function parsePlanningGates(body: Record<string, unknown>): PlanningGatesPayload | null {
  const raw = body.planning_gates;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const checksRaw = o.checks;
  const checks: PlanningGateCheck[] = [];
  if (Array.isArray(checksRaw)) {
    for (const row of checksRaw) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id ?? "").trim();
      const label = String(r.label ?? "").trim();
      const detail = String(r.detail ?? "").trim();
      if (!id || !label) continue;
      checks.push({ id, label, pass: Boolean(r.pass), detail: detail || label });
    }
  }
  if (checks.length === 0) return null;
  const presetFit: Record<string, string> = {};
  const pf = o.preset_fit;
  if (pf && typeof pf === "object") {
    for (const [k, v] of Object.entries(pf as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) presetFit[k] = v.trim();
    }
  }
  const riskCap: Record<string, number> = {};
  const rc = o.risk_cap_pct;
  if (rc && typeof rc === "object") {
    for (const [k, v] of Object.entries(rc as Record<string, unknown>)) {
      const n = numOrNull(v);
      if (n != null) riskCap[k] = n;
    }
  }
  const atrK: Record<string, number> = {};
  const ak = o.atr_k_by_preset;
  if (ak && typeof ak === "object") {
    for (const [k, v] of Object.entries(ak as Record<string, unknown>)) {
      const n = numOrNull(v);
      if (n != null) atrK[k] = n;
    }
  }
  return {
    disclaimer: typeof o.disclaimer === "string" ? o.disclaimer : DISCLAIMER,
    regime_tag: String(o.regime_tag ?? "mixed"),
    preset_fit: Object.keys(presetFit).length ? presetFit : defaultPresetFit(String(o.regime_tag ?? "mixed")),
    risk_cap_pct: Object.keys(riskCap).length ? riskCap : { ...PRESET_MAX_RISK_PCT },
    atr_k_by_preset: Object.keys(atrK).length ? atrK : { ...REFERENCE_STOP_ATR_K_BY_PRESET },
    min_rr_desk: numOrNull(o.min_rr_desk) ?? undefined,
    environment_tier:
      typeof o.environment_tier === "string" && o.environment_tier.trim() ? o.environment_tier.trim() : null,
    checks,
    all_favorable: Boolean(o.all_favorable),
    summary:
      typeof o.summary === "string" && o.summary.trim()
        ? o.summary.trim()
        : "Review planning context before sizing."
  };
}

function defaultPresetFit(regimeTag: string): Record<string, string> {
  if (regimeTag === "ranging") {
    return {
      dip: "Favorable in range — support-edge entries align with chop.",
      continuation: "Neutral — mid-range needs clear level respect.",
      breakout: "Caution — breakouts often fail without trend follow-through."
    };
  }
  if (regimeTag === "trending") {
    return {
      dip: "Caution — pullbacks can extend in strong trends.",
      continuation: "Favorable — trend continuation on retests.",
      breakout: "Favorable when volume confirms through resistance."
    };
  }
  return {
    dip: "Mixed regime — size conservatively at support.",
    continuation: "Mixed regime — confirm level before sizing.",
    breakout: "Mixed regime — require volume confirmation."
  };
}

function regimeTagFromMarketRegime(marketRegime: string): string {
  const reg = marketRegime.trim().toLowerCase();
  if (reg === "bullish" || reg === "bearish" || reg === "risk_on" || reg === "risk_off") return "trending";
  if (reg === "neutral" || reg === "sideways") return "ranging";
  return "mixed";
}

/** Client fallback when API block is absent (e.g. cached composite). */
export function buildPlanningGatesClient(args: {
  mode: "day" | "swing";
  marketRegime: string;
  riskReward: number | null;
  executionQuality: ExecutionQualityPayload | null;
  referenceStopProvenance: string | null;
  atr: number | null;
  setupJudgment: SetupJudgment | null;
  /** When true, day mode treats clock as inside 2:00–3:30 PM ET dip window. */
  inDayDipWindow?: boolean;
}): PlanningGatesPayload {
  const minRr = minRiskRewardForVerdict(args.mode);
  const regime_tag = regimeTagFromMarketRegime(args.marketRegime);
  const macroOk = args.marketRegime.trim().toLowerCase() !== "avoid";

  const vr = args.executionQuality?.volume_ratio ?? null;
  const volBand = args.executionQuality?.volume_band ?? null;
  const volumePass =
    (vr != null && vr >= 1.5) || volBand === "strong";

  const timePass = args.mode === "swing" ? true : Boolean(args.inDayDipWindow);
  const timeDetail =
    args.mode === "swing"
      ? "Swing horizon — no intraday dip clock window"
      : args.inDayDipWindow
        ? "Inside 2:00–3:30 PM ET dip window"
        : "Outside preferred dip window — RTH still open for planning";

  const prov = (args.referenceStopProvenance ?? "").toLowerCase();
  const sar = args.executionQuality?.stop_atr_ratio ?? null;
  const atrFloorPass =
    args.atr != null &&
    args.atr > 0 &&
    (prov.includes("atr") || (sar != null && sar >= 0.5 && sar <= 2.5));

  const rr = args.riskReward;
  const rrPass = rr != null && Number.isFinite(rr) && rr >= minRr;

  let timingNote = "";
  if (args.setupJudgment?.tradeability.band === "weak") {
    timingNote = " Entry timing band is weak — see setup judgment.";
  }

  const checks: PlanningGateCheck[] = [
    {
      id: "regime",
      label: "Regime context",
      pass: macroOk,
      detail: `Macro regime: ${args.marketRegime} — read as ${regime_tag}${timingNote}`
    },
    {
      id: "volume",
      label: "Volume at level (≥1.5× avg proxy)",
      pass: volumePass,
      detail: vr != null ? `Volume ratio ${vr.toFixed(2)}×` : `Volume band: ${volBand ?? "unknown"}`
    },
    {
      id: "time_window",
      label: "Time-of-day window",
      pass: timePass,
      detail: timeDetail
    },
    {
      id: "atr_floor",
      label: "ATR floor on reference stop",
      pass: atrFloorPass,
      detail: atrFloorPass
        ? "ATR floor available on reference stop"
        : "ATR missing or stop not merged with ATR policy yet"
    },
    {
      id: "risk_reward",
      label: `R/R ≥ ${minRr.toFixed(1)} : 1 (reference geometry)`,
      pass: rrPass,
      detail:
        rrPass && rr != null
          ? `R/R ${rr.toFixed(1)} : 1 at reference levels (desk min ${minRr.toFixed(1)} : 1)`
          : rr != null
            ? `R/R below desk minimum ${minRr.toFixed(1)} : 1 at reference levels`
            : "R/R unavailable at reference levels"
    }
  ];

  const all_favorable = checks.every((c) => c.pass);

  return {
    disclaimer: DISCLAIMER,
    regime_tag,
    preset_fit: defaultPresetFit(regime_tag),
    risk_cap_pct: { ...PRESET_MAX_RISK_PCT },
    atr_k_by_preset: { ...REFERENCE_STOP_ATR_K_BY_PRESET },
    checks,
    all_favorable,
    summary: all_favorable
      ? "All planning checks favorable at reference levels — still not a trade signal."
      : "Some planning checks are soft warnings — review before sizing."
  };
}
