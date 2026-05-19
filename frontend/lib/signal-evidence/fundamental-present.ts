/**
 * Fundamental backdrop presentation — interpretation only, never gating.
 */

import type { SignalEvidenceFundamentalContext } from "@/lib/signal-evidence";
import type { SignalsLayerStatus } from "@/lib/signals-page-present";

export type FundamentalBackdropLevel = "positive" | "neutral" | "mixed" | "weak";

export type FundamentalBackdropSummary = {
  headline: string;
  backdrop: FundamentalBackdropLevel;
  bullets: string[];
  convictionNote: string | null;
};

export type FundamentalContextPillarLine = {
  label: string;
  text: string;
};

export type FundamentalContextPresentation = {
  narrative: string[];
  pillars: FundamentalContextPillarLine[];
  sectorLine: string | null;
  /** Colored backdrop chip when company-specific fundamentals carry a signal. */
  backdropChip: { icon: string; label: string; tone: FundamentalBackdropLevel } | null;
};

export const FUNDAMENTAL_CONTEXT_FOOTER =
  "Signal data only — not investment advice. Does not affect layer scores or alignment.";

const QUIET_EARNINGS = "no recent signal";
const QUIET_GUIDANCE = "no material change";
const QUIET_ANALYSTS = "no notable activity";

export function fundamentalPillarsAreQuiet(ctx: SignalEvidenceFundamentalContext): boolean {
  return (
    ctx.earnings_trend === "unknown" &&
    ctx.guidance_direction === "unknown" &&
    ctx.analyst_direction === "unknown"
  );
}

export function formatFundamentalEarningsLine(ctx: SignalEvidenceFundamentalContext): string {
  if (ctx.earnings_trend === "unknown") return QUIET_EARNINGS;
  const totalQ = Math.max(1, ctx.quarters_beating + ctx.quarters_missing);
  if (ctx.earnings_trend === "beating") return `beating ${ctx.quarters_beating}/${totalQ} recent quarters`;
  if (ctx.earnings_trend === "missing") return `missing ${ctx.quarters_missing}/${totalQ} recent quarters`;
  return "inline vs estimates";
}

export function formatFundamentalGuidanceLine(ctx: SignalEvidenceFundamentalContext): string {
  switch (ctx.guidance_direction) {
    case "raised":
      return "raised";
    case "lowered":
      return "cut / lowered";
    case "maintained":
      return "maintained";
    default:
      return QUIET_GUIDANCE;
  }
}

export function formatFundamentalAnalystsLine(ctx: SignalEvidenceFundamentalContext): string {
  if (ctx.analyst_direction === "upgrading") {
    return `${ctx.recent_upgrades} upgrade${ctx.recent_upgrades === 1 ? "" : "s"} recent`;
  }
  if (ctx.analyst_direction === "downgrading") {
    return `${ctx.recent_downgrades} downgrade${ctx.recent_downgrades === 1 ? "" : "s"} recent`;
  }
  if (ctx.analyst_direction === "stable") return "stable consensus";
  return QUIET_ANALYSTS;
}

export function formatFundamentalRevenueLine(
  trend: SignalEvidenceFundamentalContext["revenue_trend"]
): string | null {
  switch (trend) {
    case "growing":
      return "revenue growing YoY";
    case "declining":
      return "revenue declining YoY";
    case "flat":
      return "revenue flat YoY";
    default:
      return null;
  }
}

function sectorLineFromContext(ctx: SignalEvidenceFundamentalContext): string | null {
  if (!ctx.sector_display_name) return null;
  return ctx.sector_etf
    ? `Sector: ${ctx.sector_display_name} (${ctx.sector_etf})`
    : `Sector: ${ctx.sector_display_name}`;
}

const BACKDROP_CHIP: Record<FundamentalBackdropLevel, { icon: string; label: string }> = {
  positive: { icon: "↑", label: "Positive fundamental backdrop" },
  neutral: { icon: "→", label: "Neutral fundamental backdrop" },
  mixed: { icon: "~", label: "Mixed fundamental backdrop" },
  weak: { icon: "↓", label: "Weak fundamental backdrop" }
};

export function buildFundamentalContextPresentation(
  context: SignalEvidenceFundamentalContext | null | undefined
): FundamentalContextPresentation {
  if (!context) {
    return {
      narrative: ["Fundamental context is not available for this symbol right now."],
      pillars: [],
      sectorLine: null,
      backdropChip: null
    };
  }

  const sectorLine = sectorLineFromContext(context);
  const pillars: FundamentalContextPillarLine[] = [
    { label: "Earnings", text: formatFundamentalEarningsLine(context) },
    { label: "Guidance", text: formatFundamentalGuidanceLine(context) },
    { label: "Analysts", text: formatFundamentalAnalystsLine(context) }
  ];
  const revenue = formatFundamentalRevenueLine(context.revenue_trend);
  if (revenue) {
    pillars.push({ label: "Revenue", text: revenue });
  }

  if (fundamentalPillarsAreQuiet(context)) {
    return {
      narrative: [
        "No fundamental catalyst influencing this setup.",
        "Price behavior is currently driven by broader market conditions."
      ],
      pillars,
      sectorLine,
      backdropChip: null
    };
  }

  const chip = BACKDROP_CHIP[context.backdrop];
  const summary = context.summary_line
    .replace(/\.\s*Signal data only\.?$/i, "")
    .trim();
  const narrative = summary ? [summary] : [];

  return {
    narrative,
    pillars,
    sectorLine,
    backdropChip: { icon: chip.icon, label: chip.label, tone: context.backdrop }
  };
}

export function capitalizeBackdrop(level: FundamentalBackdropLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function revenueTrendInterpretation(
  trend: SignalEvidenceFundamentalContext["revenue_trend"]
): string {
  switch (trend) {
    case "growing":
      return "Growing (supportive backdrop)";
    case "declining":
      return "Declining (negative tailwind)";
    case "flat":
      return "Flat (neutral backdrop)";
    default:
      return "Unknown";
  }
}

/** Short bullets for Signals setup read. */
export function revenueTrendBackdropBullet(
  trend: SignalEvidenceFundamentalContext["revenue_trend"]
): string | null {
  switch (trend) {
    case "growing":
      return "Revenue trend growing";
    case "declining":
      return "Revenue trend declining";
    case "flat":
      return "Revenue trend flat";
    default:
      return null;
  }
}

export function earningsBackdropBullet(
  daysAway: number | null | undefined,
  risk?: string | null
): string | null {
  if (daysAway == null || !Number.isFinite(daysAway) || daysAway < 0 || daysAway > 30) {
    return null;
  }
  if (daysAway <= 7) {
    if (daysAway <= 1 || risk === "imminent") {
      return "Earnings risk imminent";
    }
    return "Earnings risk upcoming";
  }
  if (daysAway <= 30) {
    return "Earnings on horizon";
  }
  return null;
}

export function catalystBullet(newsStatus: SignalsLayerStatus | undefined): string | null {
  if (newsStatus === "Bullish") return null;
  if (newsStatus === "Bearish") return "Headline flow negative vs direction";
  return "No positive catalyst";
}

export function buildFundamentalBackdropBullets(input: {
  context: SignalEvidenceFundamentalContext | null | undefined;
  earningsDaysAway?: number | null;
  earningsRisk?: string | null;
  newsStatus?: SignalsLayerStatus;
}): string[] {
  const out: string[] = [];
  const ctx = input.context;
  if (ctx) {
    const rev = revenueTrendBackdropBullet(ctx.revenue_trend);
    if (rev) out.push(rev);
    if (ctx.guidance_direction === "lowered") {
      out.push("Guidance cut");
    } else if (ctx.guidance_direction === "raised") {
      out.push("Guidance raised");
    }
    if (ctx.analyst_direction === "downgrading") {
      out.push("Analyst downgrades in the window");
    }
  }
  const cat = catalystBullet(input.newsStatus);
  if (cat) out.push(cat);
  const earn = earningsBackdropBullet(input.earningsDaysAway, input.earningsRisk);
  if (earn) out.push(earn);
  return out.slice(0, 5);
}

/** Risk-horizon copy for Evidence (fundamental sensitivity + macro), not backdrop bullets. */
export function buildEvidenceRiskHorizonFactors(input: {
  context: SignalEvidenceFundamentalContext | null | undefined;
  earningsDaysAway?: number | null;
  earningsRisk?: string | null;
  /** When true, earnings lines are omitted (banner already covers them). */
  omitEarnings?: boolean;
  macroWarnings?: string[];
}): string[] {
  const out: string[] = [];
  if (!input.omitEarnings) {
    const days = input.earningsDaysAway;
    if (days != null && Number.isFinite(days) && days >= 0 && days <= 30) {
      if (days <= 7) {
        out.push(`Earnings in ${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`);
      } else {
        out.push("Earnings on horizon (calendar context)");
      }
    }
    if (input.earningsRisk === "imminent" && !out.some((l) => l.startsWith("Earnings"))) {
      out.push("Earnings risk imminent");
    }
  }
  const rev = input.context?.revenue_trend;
  if (rev === "declining") {
    out.push("Weak revenue trend increases downside sensitivity");
  } else if (rev === "flat") {
    out.push("Flat revenue trend — limited fundamental tailwind");
  }
  if (input.context?.guidance_direction === "lowered") {
    out.push("Guidance cut — narrative headwind");
  }
  for (const w of input.macroWarnings ?? []) {
    const trimmed = w.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out.slice(0, 5);
}

export function buildFundamentalConvictionNote(
  backdrop: FundamentalBackdropLevel | null,
  setupActionable: boolean
): string | null {
  if (!backdrop) return null;
  if (backdrop === "positive") {
    return setupActionable
      ? "Fundamental backdrop supportive — layer alignment still governs the read."
      : "Fundamental backdrop supportive — layer gates still apply.";
  }
  if (backdrop === "weak") {
    return "Setup may still meet layer rules, but fundamental backdrop is weak — conviction is lower, not blocked.";
  }
  if (backdrop === "mixed") {
    return "Mixed fundamental backdrop — treat layer alignment as primary; narrative is split.";
  }
  return "Neutral fundamental backdrop — layer alignment remains primary.";
}

export function buildFundamentalBackdropSummary(input: {
  context: SignalEvidenceFundamentalContext | null | undefined;
  earningsDaysAway?: number | null;
  earningsRisk?: string | null;
  newsStatus?: SignalsLayerStatus;
  setupActionable?: boolean;
}): FundamentalBackdropSummary | null {
  const ctx = input.context;
  if (!ctx) {
    const earnOnly = earningsBackdropBullet(input.earningsDaysAway, input.earningsRisk);
    if (!earnOnly) return null;
    return {
      headline: "Fundamental backdrop: Limited",
      backdrop: "neutral",
      bullets: [earnOnly],
      convictionNote: "Earnings calendar context only — not a layer score."
    };
  }

  const backdrop = ctx.backdrop;
  const bullets = buildFundamentalBackdropBullets(input);
  if (fundamentalPillarsAreQuiet(ctx)) {
    const pres = buildFundamentalContextPresentation(ctx);
    bullets.push(...pres.narrative);
    for (const row of pres.pillars) {
      bullets.push(`${row.label}: ${row.text}`);
    }
  } else if (bullets.length === 0 && ctx.summary_line) {
    bullets.push(ctx.summary_line.replace(/\.\s*Signal data only\.?$/i, "").trim() || ctx.summary_line);
  }

  return {
    headline: `Fundamental backdrop: ${capitalizeBackdrop(backdrop)}`,
    backdrop,
    bullets,
    convictionNote: buildFundamentalConvictionNote(backdrop, Boolean(input.setupActionable))
  };
}

export function backdropToneColor(
  backdrop: FundamentalBackdropLevel,
  colors: { bullish: string; bearish: string; caution: string; textMuted: string }
): string {
  switch (backdrop) {
    case "positive":
      return colors.bullish;
    case "weak":
      return colors.bearish;
    case "mixed":
      return colors.caution;
    default:
      return colors.textMuted;
  }
}
