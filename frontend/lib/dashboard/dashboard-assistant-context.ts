/**
 * Tier 1.C Phase 4 — versioned dashboard assistant page context.
 * Mirrors on-screen sections only; lists come from the same arrays the UI renders.
 */

import type { DeskTodayData } from "@/lib/api/desk-today";
import type { EarningsEvent } from "@/lib/api/earnings-types";
import type { GapIntelligenceItem, IntradaySetupPayload } from "@/lib/api/scanner";
import type { DashboardDeskMode } from "@/lib/dashboard/live-status-copy";
import { resolveDiscoveryLeaders } from "@/lib/dashboard/desk-today-present";
import type {
  AssistantPageContext,
  AssistantScannerGapSummary,
  AssistantScannerSetupSummary,
  DashboardAssistantContextV1
} from "@/lib/assistant/types";
import type { DayDeskPostureKind } from "@/lib/dashboard-posture";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import { isAfterOrbCloseEt } from "@/lib/market-hours-et";
import { topSignalStrengthPercent } from "@/lib/top-signal-strength";

export const DASHBOARD_CONTEXT_VERSION = 1 as const;

export type BuildDashboardAssistantPageContextInput = {
  regimeLabel: string;
  swingDeskPosture: "active" | "monitor" | "suppressed";
  dayDeskPosture?: DayDeskPostureKind;
  daySetupsCount: number;
  dayTradingSurfaces: boolean;
  swingTopSignals: IntradaySetupPayload[];
  gapIntelligence: GapIntelligenceItem[];
  swingUniverseSymbolCount: number | null;
  gapSnapshotSymbolCount: number | null;
  gapUniverseNote?: string | null;
  upcomingEarnings: EarningsEvent[];
  scannerDataSettled: boolean;
  discoveryExpanded: boolean;
  activeDeskMode?: DashboardDeskMode;
  deskData?: DeskTodayData | null;
  marketEnvironmentSwing?: MarketEnvironmentPayload | null;
  marketEnvironmentDay?: MarketEnvironmentPayload | null;
};

function isLongDirection(direction: string): boolean {
  const d = direction.trim().toLowerCase();
  return d === "long" || d === "buy" || d === "bullish";
}

function strengthBucket(pct: number): AssistantScannerSetupSummary["strength_bucket"] {
  return pct >= 70 ? "strong" : pct >= 50 ? "moderate" : "weak";
}

function gapQualityBucket(score: number): AssistantScannerGapSummary["quality_bucket"] {
  return score >= 80 ? "high" : score >= 60 ? "medium" : "low";
}

function gapDirection(pct: number): "up" | "down" | null {
  if (pct > 0.05) return "up";
  if (pct < -0.05) return "down";
  return null;
}

function sortGaps(items: GapIntelligenceItem[]): GapIntelligenceItem[] {
  return [...items].sort((a, b) => {
    const sa = typeof a.gap_quality_score === "number" ? a.gap_quality_score : 0;
    const sb = typeof b.gap_quality_score === "number" ? b.gap_quality_score : 0;
    return sb - sa;
  });
}

function mapSetupSummaries(setups: IntradaySetupPayload[]): AssistantScannerSetupSummary[] {
  return setups.slice(0, 3).map((setup) => {
    const strengthPct = topSignalStrengthPercent(setup);
    const patternRaw = setup.triggers?.[0] ?? "";
    return {
      symbol: setup.symbol.trim().toUpperCase(),
      direction: isLongDirection(setup.direction) ? "long" : "short",
      strength_bucket: strengthBucket(strengthPct),
      confluence: setup.is_confluence_alert === true,
      orb_expired: patternRaw.toLowerCase().startsWith("orb_") && isAfterOrbCloseEt()
    };
  });
}

function mapGapSummaries(items: GapIntelligenceItem[], limit: number): AssistantScannerGapSummary[] {
  const out: AssistantScannerGapSummary[] = [];
  for (const item of sortGaps(items).slice(0, limit)) {
    const dir = gapDirection(item.gap_pct);
    if (!dir) continue;
    const sentRaw = (item.catalyst?.sentiment ?? "").toLowerCase();
    const catalyst_sentiment: AssistantScannerGapSummary["catalyst_sentiment"] | undefined =
      sentRaw === "bullish" || sentRaw === "bearish" || sentRaw === "neutral" ? sentRaw : undefined;
    const catRaw = (item.catalyst?.category ?? "").trim().toLowerCase();
    out.push({
      symbol: item.symbol.trim().toUpperCase(),
      gap_direction: dir,
      quality_bucket: gapQualityBucket(item.gap_quality_score),
      catalyst_category: catRaw || undefined,
      catalyst_sentiment
    });
  }
  return out;
}

/** Build the whitelisted dashboard page context (flat + nested v1 block). */
export function buildDashboardAssistantPageContext(
  input: BuildDashboardAssistantPageContextInput
): AssistantPageContext {
  const regime = input.regimeLabel.trim() || "Neutral";
  const deskMode = input.activeDeskMode ?? "swing";
  const { leaders: deskLeaders, source: deskSource } = resolveDiscoveryLeaders(
    input.deskData,
    input.scannerDataSettled ? input.gapIntelligence : [],
    deskMode
  );
  const gapLeaders = input.scannerDataSettled ? sortGaps(input.gapIntelligence).slice(0, 10) : [];
  const leaderSymbols =
    deskLeaders.length > 0
      ? deskLeaders.map((l) => l.symbol)
      : gapLeaders.map((g) => g.symbol.trim().toUpperCase());
  const discoverySource: DashboardAssistantContextV1["discovery"]["source"] =
    deskLeaders.length > 0 ? deskSource : deskLeaders.length === 0 && gapLeaders.length > 0 ? "gap_fallback" : "empty";
  const previewSymbols = leaderSymbols.slice(0, 3);
  const sessionActivitySymbols = deskLeaders.map((l) => l.symbol.trim().toUpperCase()).filter(Boolean);
  const withCatalyst =
    deskLeaders.length > 0
      ? deskLeaders.filter((l) => (l.verdict ?? "").toLowerCase().includes("catalyst")).length
      : gapLeaders.filter((g) => g.has_catalyst).length;
  const recentlyHot = Array.isArray(input.deskData?.recently_hot)
    ? input.deskData!.recently_hot!.map((r) => r.symbol.trim().toUpperCase()).filter(Boolean).slice(0, 5)
    : [];

  const gapWithCatalyst = gapLeaders.filter((g) => g.has_catalyst).length;
  const gapWithoutCatalyst = Math.max(0, gapLeaders.length - gapWithCatalyst);
  const gapIntelNote =
    input.scannerDataSettled && gapLeaders.length === 0
      ? (input.gapUniverseNote?.trim() ||
          (input.gapSnapshotSymbolCount != null && input.gapSnapshotSymbolCount < 100
            ? "Gap Intelligence empty — scan may have used a bounded symbol list (watchlist + liquid leaders) or no names met gap/volume gates."
            : "Gap Intelligence empty — no symbols met gap magnitude, volume, and quality gates this session."))
      : input.gapUniverseNote?.trim() || null;

  const dashboard_context: DashboardAssistantContextV1 = {
    version: DASHBOARD_CONTEXT_VERSION,
    regime,
    discovery: {
      leader_count: leaderSymbols.length,
      with_catalyst_count: withCatalyst,
      preview_symbols: previewSymbols,
      source: discoverySource,
      scanned_count:
        typeof input.deskData?.eligible_symbol_count === "number"
          ? input.deskData.eligible_symbol_count
          : input.scannerDataSettled
            ? input.gapSnapshotSymbolCount
            : null,
      generated_at: input.deskData?.generated_at ?? null,
      ...(recentlyHot.length > 0 ? { recently_hot: recentlyHot } : {})
    },
    session_activity: {
      count: sessionActivitySymbols.length,
      symbols: sessionActivitySymbols.slice(0, 15),
      preview_symbols: sessionActivitySymbols.slice(0, 8),
      source: sessionActivitySymbols.length > 0 ? deskSource : "empty",
      note:
        "Opportunity pipeline stage Session activity — today's session movers for context only (not actionable swing/day desk setups). ranked_setups_count is scanner qualifying setups, not this list."
    },
    universe: {
      swing_universe_symbol_count: input.scannerDataSettled ? input.swingUniverseSymbolCount : null,
      gap_snapshot_symbol_count: input.scannerDataSettled ? input.gapSnapshotSymbolCount : null
    },
    swing_desk_posture: input.swingDeskPosture,
    ...(input.dayTradingSurfaces && input.dayDeskPosture
      ? { day_desk_posture: input.dayDeskPosture }
      : {}),
    top_setups: mapSetupSummaries(input.swingTopSignals),
    gap_intel_summary: {
      leader_count: gapLeaders.length,
      with_catalyst_count: gapWithCatalyst,
      without_catalyst_count: gapWithoutCatalyst,
      preview_symbols: gapLeaders.slice(0, 5).map((g) => g.symbol.trim().toUpperCase()),
      ...(gapIntelNote ? { empty_note: gapIntelNote } : {})
    },
    gap_leaders_detail: input.scannerDataSettled ? mapGapSummaries(gapLeaders, 8) : [],
    macro_events: input.upcomingEarnings.slice(0, 5).map((e) => ({
      symbol: e.symbol.trim().toUpperCase(),
      report_date: e.report_date,
      report_time: e.report_time
    })),
    ...(input.marketEnvironmentSwing
      ? {
          market_environment: {
            tier: input.marketEnvironmentSwing.environment_tier,
            headline: input.marketEnvironmentSwing.headline,
            vix_level: input.marketEnvironmentSwing.vix_level,
            new_swing_allowed: input.marketEnvironmentSwing.new_swing_allowed,
            new_day_allowed: input.marketEnvironmentSwing.new_day_allowed,
            min_rr_swing: input.marketEnvironmentSwing.min_rr_swing,
            min_rr_day: input.marketEnvironmentSwing.min_rr_day
          }
        }
      : {})
  };

  const envHeadline = input.marketEnvironmentSwing?.headline;

  return {
    page: "dashboard",
    market_regime: regime,
    ...(envHeadline
      ? {
          environment_tier: input.marketEnvironmentSwing?.environment_tier,
          environment_headline: envHeadline
        }
      : {}),
    ranked_setups_count: input.swingTopSignals.length,
    swing_desk_posture: input.swingDeskPosture,
    top_setups: dashboard_context.top_setups,
    dashboard_context,
    ...(input.dayTradingSurfaces && input.dayDeskPosture != null
      ? { day_desk_posture: input.dayDeskPosture, day_setups_count: input.daySetupsCount }
      : {})
  };
}
