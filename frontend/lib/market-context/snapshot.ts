import type { MacroContextPayload } from "@/lib/api/fetch-macro-context";
import type { EarningsEvent } from "@/lib/api/earnings";
import type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";
import {
  macroRiskStateHeadline,
  macroRiskStateTip,
  sectorTapeKindFromPct5d,
  weeklyIndexAvgPct5d
} from "@/lib/dashboard-posture";
import {
  breadthPillLabel,
  buildEnvironmentSummary,
  classifyParticipation,
  classifyRiskHorizon,
  classifyRotationProfile,
  classifyVolatility,
  participationPlainLine,
  rotationProfilePlainLine,
  volatilityPillLabel,
  volatilityPlainLine,
  type ParticipationCategory,
  type RiskHorizonCategory,
  type RotationProfileCategory,
  type VolatilityCategory
} from "@/lib/market-context/derivations";
import { regimeBadgeExplanation, regimeOneLiner } from "@/lib/market-context/regime";
import type { SectorRotationChip } from "@/lib/market-context/types";

export type MarketContextPillId = "regime" | "volatility" | "breadth" | "sectors" | "macro";

export type MarketContextExplainLine = { label: string; value: string };

export type MarketContextPillTone = "bullish" | "bearish" | "caution" | "muted" | "neutral";

export type MarketContextPill = {
  id: MarketContextPillId;
  /** Short category name shown before the colon, e.g. "Regime". */
  category: string;
  /** Value after the colon, e.g. "Bearish". */
  value: string;
  tone: MarketContextPillTone;
  summaryLine: string;
  inputs: MarketContextExplainLine[];
  rule: string;
};

export type MarketContextIndexStat = {
  symbol: string;
  label: string;
  pct5d: number | null;
  formattedPct: string;
  tone: "bullish" | "bearish" | "muted";
};

export type MarketContextSnapshot = {
  indexStats: MarketContextIndexStat[];
  pills: MarketContextPill[];
  environmentSummary: string;
  derived: {
    volatility: VolatilityCategory;
    participation: ParticipationCategory;
    rotationProfile: RotationProfileCategory;
    riskHorizon: RiskHorizonCategory;
    sectorTape: ReturnType<typeof sectorTapeKindFromPct5d>;
    weeklyAvgPct5d: number | null;
  };
};

function formatPct5d(pct: number | null): { formatted: string; tone: MarketContextIndexStat["tone"] } {
  if (pct == null || !Number.isFinite(pct)) return { formatted: "—", tone: "muted" };
  const sign = pct >= 0 ? "+" : "";
  return {
    formatted: `${sign}${pct.toFixed(2)}%`,
    tone: pct > 0.05 ? "bullish" : pct < -0.05 ? "bearish" : "muted"
  };
}

function sectorTapePillLabel(kind: ReturnType<typeof sectorTapeKindFromPct5d>): string {
  switch (kind) {
    case "defensive":
      return "Defensive";
    case "risk_on":
      return "Risk-on";
    case "mixed":
      return "Mixed";
    case "narrow":
      return "Narrow";
    default:
      return "Pending";
  }
}

function macroPillLabel(macro: MacroContextPayload | null): string {
  const h = macroRiskStateHeadline(macro);
  if (h === "Known / absorbed") return "Quiet";
  if (h === "Upcoming") return "Upcoming";
  return h;
}

function pillToneForRegime(label: string): MarketContextPillTone {
  const r = label.toLowerCase();
  if (r.includes("bull")) return "bullish";
  if (r.includes("bear")) return "bearish";
  if (r.includes("neutral") || r.includes("mixed")) return "caution";
  return "muted";
}

function pillToneForVolatility(cat: VolatilityCategory): MarketContextPillTone {
  if (cat === "Expanding") return "caution";
  if (cat === "Unknown") return "muted";
  return "neutral";
}

function pillToneForBreadth(cat: ParticipationCategory): MarketContextPillTone {
  if (cat === "Broad") return "bullish";
  if (cat === "Narrow") return "bearish";
  if (cat === "Mixed") return "caution";
  return "muted";
}

export function buildMarketContextSnapshot(input: {
  weeklyIndexRows: WeeklyIndexRow[];
  sectorRotation: SectorRotationChip[];
  upcomingEarnings: EarningsEvent[];
  macro: MacroContextPayload | null;
  regimeLabel: string;
  regimePriceBreadthOnly: boolean;
  vixLevel: number | null;
  vixSessionPct: number | null;
  vixPulseOk: boolean;
  spyPct: number | null;
  qqqPct: number | null;
}): MarketContextSnapshot {
  const sectorPcts = input.sectorRotation.map((s) => s.pct5d);
  const indexPcts = input.weeklyIndexRows.map((r) => r.pct5d);
  const weeklyAvg = weeklyIndexAvgPct5d(indexPcts);
  const volatility = classifyVolatility(input.vixLevel, input.vixSessionPct);
  const participation = classifyParticipation(sectorPcts, indexPcts);
  const rotationProfile = classifyRotationProfile(sectorPcts);
  const macroWarning = input.macro?.warnings?.[0] ?? null;
  const riskHorizon = classifyRiskHorizon(input.upcomingEarnings, macroWarning);
  const sectorTape = sectorTapeKindFromPct5d(sectorPcts);

  const soonest = input.upcomingEarnings[0];
  const soonestSymbol = soonest?.symbol;
  const soonestDateLabel = soonest?.report_date;

  const indexStats: MarketContextIndexStat[] = input.weeklyIndexRows.map((row) => {
    const { formatted, tone } = formatPct5d(row.pct5d);
    return { symbol: row.symbol, label: row.label, pct5d: row.pct5d, formattedPct: formatted, tone };
  });

  const regimeExplain = regimeBadgeExplanation(input.vixPulseOk);
  const pills: MarketContextPill[] = [
    {
      id: "regime",
      category: "Regime",
      value: input.regimeLabel,
      tone: pillToneForRegime(input.regimeLabel),
      summaryLine: regimeOneLiner(input.regimeLabel, input.regimePriceBreadthOnly),
      inputs: [
        { label: "SPY session %", value: input.spyPct != null ? `${input.spyPct >= 0 ? "+" : ""}${input.spyPct.toFixed(2)}%` : "—" },
        { label: "QQQ session %", value: input.qqqPct != null ? `${input.qqqPct >= 0 ? "+" : ""}${input.qqqPct.toFixed(2)}%` : "—" },
        {
          label: "VIX pulse",
          value: input.vixPulseOk
            ? input.vixLevel != null
              ? `Level ${input.vixLevel.toFixed(1)}`
              : "Available"
            : "Unavailable (breadth-only regime)"
        }
      ],
      rule:
        "Bullish when SPY > +0.2% and QQQ > +0.15% on the session tape; Bearish when SPY < −0.2% or QQQ < −0.25%; otherwise Neutral. Scanner tape wins when both index %s are present."
    },
    {
      id: "volatility",
      category: "Volatility",
      value: volatilityPillLabel(volatility),
      tone: pillToneForVolatility(volatility),
      summaryLine: volatilityPlainLine(volatility),
      inputs: [
        { label: "VIX level", value: input.vixLevel != null ? input.vixLevel.toFixed(1) : "—" },
        {
          label: "VIX session %",
          value: input.vixSessionPct != null ? `${input.vixSessionPct >= 0 ? "+" : ""}${input.vixSessionPct.toFixed(2)}%` : "—"
        },
        { label: "Internal band", value: volatility }
      ],
      rule: "High when VIX ≥ 22 or session change ≥ +5%; Low when VIX ≤ 13 or session change ≤ −5%; otherwise Low (contained). Dashboard shows the band only, not raw VIX."
    },
    {
      id: "breadth",
      category: "Breadth",
      value: breadthPillLabel(participation),
      tone: pillToneForBreadth(participation),
      summaryLine: participationPlainLine(participation),
      inputs: [
        {
          label: "Sector ETFs up (5d)",
          value: `${sectorPcts.filter((v) => typeof v === "number" && v > 0).length} of ${sectorPcts.filter((v) => v != null).length}`
        },
        {
          label: "Indices up (5d)",
          value: `${indexPcts.filter((v) => typeof v === "number" && v > 0).length} of ${indexPcts.filter((v) => v != null).length}`
        }
      ],
      rule: "Strong only when ≥4 of 5 sector ETFs and ≥2 of 3 indices are positive on 5d; Weak when ≤1 in each layer; otherwise Mixed."
    },
    {
      id: "sectors",
      category: "Sectors",
      value: sectorTapePillLabel(sectorTape),
      tone: sectorTape === "risk_on" ? "bullish" : sectorTape === "defensive" ? "bearish" : "neutral",
      summaryLine: rotationProfilePlainLine(rotationProfile),
      inputs: input.sectorRotation.slice(0, 5).map((s) => ({
        label: s.symbol,
        value: s.pct5d != null ? `${s.pct5d >= 0 ? "+" : ""}${s.pct5d.toFixed(2)}% (5d)` : "—"
      })),
      rule: "Tape tone from ETF 5d moves: ≥3 up with ≤1 down → Risk-on; ≥3 down with ≤1 up → Defensive; both sides active → Mixed; else Narrow."
    },
    {
      id: "macro",
      category: "Macro",
      value: macroPillLabel(input.macro),
      tone: macroPillLabel(input.macro) === "Elevated" ? "caution" : "neutral",
      summaryLine: macroRiskStateTip(input.macro),
      inputs: [
        { label: "Macro risk level", value: String(input.macro?.macro_risk_level ?? input.macro?.macro_risk ?? "—") },
        { label: "Tracked earnings (7d)", value: String(input.upcomingEarnings.length) }
      ],
      rule: "Macro headline from FRED + Polygon pulse; earnings density adds context but does not override an active macro warning."
    }
  ];

  return {
    indexStats,
    pills,
    environmentSummary: buildEnvironmentSummary(weeklyAvg, volatility, participation, riskHorizon),
    derived: {
      volatility,
      participation,
      rotationProfile,
      riskHorizon,
      sectorTape,
      weeklyAvgPct5d: weeklyAvg
    }
  };
}

/** Footnote under index stats — shared copy. */
export const MARKET_CONTEXT_INDEX_FOOTNOTE = "5-day change on each index.";
