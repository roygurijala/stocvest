"use client";

import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AlignJustify, ArrowDown, ArrowUp, Brain, Clock } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CardTone, ThemeColors } from "@/lib/design-system";
import { borderRadius, cardSurfaceStyle, spacing, typography } from "@/lib/design-system";
import { useIsMobileLayout } from "@/lib/hooks/use-is-mobile-layout";
import { useTheme } from "@/lib/theme-provider";
import { DecisionMetric } from "@/components/decision-metric";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { synthTradeDecision, type TradeDecisionState } from "@/lib/signal-evidence/trade-decision";
import {
  catalystPublishedAgo,
  buildVerdictTagReconciler,
  deriveEvidenceInsightFallback,
  filterChipsForMode,
  layerFreshnessFromIso,
  sanitizeEvidenceChips,
  structuralBandFromBaselineScore,
  VWAP_STATE,
  getVWAPDisplay,
  type CompositeAlignmentWire,
  type EvidenceLayer,
  type EvidenceStatus,
  type GeopoliticalLayerExtras,
  type SectorDailySessionWire,
  type SectorResolutionStateWire,
  type SignalEvidenceData,
  type SignalEvidenceInsight
} from "@/lib/signal-evidence";
import {
  compositeSignalScoreTooltip,
  marketRegimeDecisionTooltip,
  riskRewardEntryDecisionTooltip,
  trendStrengthDecisionTooltip
} from "@/lib/metric-decision-copy";
import { pickNewsEmptyCopy } from "@/lib/news-empty-copy";
import { AI_VERDICT_TIP, CONFIDENCE_PERCENT_TIP, LAYER_NAME_HINTS } from "@/lib/ui-tooltips";
import { AIExplanationDisplay } from "@/components/ai-explanation-display";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { useHasAIExplanations, useUserProfileLoaded } from "@/lib/api/user";

interface SignalEvidenceCardProps {
  evidence: SignalEvidenceData;
  onOpenNewsPanel?: (symbol: string) => void;
}

function statusColor(status: EvidenceStatus, colors: ThemeColors): string {
  if (status === "Bullish") return colors.bullish;
  if (status === "Bearish") return colors.bearish;
  if (status === "Neutral") return colors.caution;
  if (status === "As of close") return colors.text;
  return colors.textMuted;
}

function decisionLineColor(state: TradeDecisionState, colors: ThemeColors): string {
  if (state === "actionable") return colors.bullish;
  if (state === "blocked") return colors.bearish;
  return colors.caution;
}

function toneFromStatus(status: EvidenceStatus): CardTone {
  if (status === "Bullish") return "bullish";
  if (status === "Bearish") return "bearish";
  if (status === "Neutral") return "caution";
  return "neutral";
}

/**
 * Local alias for the canonical card shell. Kept as a one-liner so existing
 * call sites in this file (`...elevatedCardStyle(colors, tone)`) stay
 * unchanged while the underlying shape lives in design-system.ts as
 * {@link cardSurfaceStyle} — the single source of truth for the app-wide
 * card visual contract.
 */
function elevatedCardStyle(colors: ThemeColors, tone: CardTone = "neutral"): CSSProperties {
  return cardSurfaceStyle(colors, tone);
}

function formatLevel(n: number | null | undefined): string {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "—";
}

const MAX_UPDATED_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function displayUpdatedLabel(evidence: SignalEvidenceData): string {
  const raw = evidence.updatedAtIso;
  if (raw == null || String(raw).trim() === "") {
    return "Just now";
  }
  const ms = Date.parse(String(raw));
  if (!Number.isFinite(ms)) {
    return "Just now";
  }
  const ageMs = Date.now() - ms;
  if (ageMs < 0 || ageMs > MAX_UPDATED_AGE_MS) {
    return "Just now";
  }
  return evidence.updatedLabel;
}

const MAX_REASONABLE_HOURS = 24 * 30;

function displayLayerFreshness(layer: EvidenceLayer, evidence: SignalEvidenceData): string {
  if (layer.key === "technical") {
    return layerFreshnessFromIso(evidence.updatedAtIso);
  }
  const m = /^Updated (\d+)h ago$/.exec(layer.freshnessLabel);
  if (m) {
    const hours = Number(m[1]);
    if (Number.isFinite(hours) && hours > MAX_REASONABLE_HOURS) {
      return "Just now";
    }
  }
  return layer.freshnessLabel;
}

function scoreHeaderColor(score: number, colors: ThemeColors): string {
  if (score >= 70) return colors.bullish;
  if (score >= 50) return colors.caution;
  return colors.bearish;
}

function trendStrengthColor(strength: string, colors: ThemeColors): string {
  const s = strength.toLowerCase();
  if (s === "strong") return colors.bullish;
  if (s === "moderate") return colors.caution;
  return colors.bearish;
}

function rrChipColor(rr: number, colors: ThemeColors): string {
  if (rr >= 4) return colors.bullish;
  if (rr >= 3) return "#86efac";
  if (rr >= 2) return colors.text;
  if (rr >= 1.5) return colors.caution;
  return colors.bearish;
}

function regimeColor(regime: string, colors: ThemeColors): string {
  const r = regime.toLowerCase();
  if (r === "bullish") return colors.bullish;
  if (r === "bearish") return colors.bearish;
  return colors.caution;
}

function sectorResolutionLabel(state: SectorResolutionStateWire | null | undefined): string {
  if (!state) return "";
  if (state === "resolved") return "Resolved";
  if (state === "pending_cache_refresh") return "Unavailable (not factored)";
  return "Unmapped";
}

function alignmentAccent(level: CompositeAlignmentWire["level"], colors: ThemeColors): string {
  if (level === "full" || level === "strong") return colors.bullish;
  if (level === "conflict") return colors.bearish;
  return colors.caution;
}

function formatDirShort(d: string): string {
  const x = (d || "neutral").trim().toLowerCase();
  if (x === "bullish") return "Bull";
  if (x === "bearish") return "Bear";
  return "Neutral";
}

function sectorLayerHasMomentumDetails(layer: EvidenceLayer): boolean {
  if (layer.key !== "sector") return false;
  return (
    layer.sector_resolution_state != null ||
    layer.sector_interpretation != null ||
    layer.sector_data_available != null ||
    layer.sector_persistence != null ||
    layer.sector_sessions_leading != null ||
    (layer.sector_daily_sessions != null && layer.sector_daily_sessions.length > 0)
  );
}

function SectorMomentumPanel({ layer, colors }: { layer: EvidenceLayer; colors: ThemeColors }) {
  const st = layer.sector_resolution_state;
  const interp = layer.sector_interpretation?.trim();
  const lead =
    typeof layer.sector_sessions_leading === "number" && typeof layer.sector_total_sessions === "number"
      ? `${layer.sector_sessions_leading}/${layer.sector_total_sessions}`
      : null;
  const pers =
    typeof layer.sector_persistence === "number" && Number.isFinite(layer.sector_persistence)
      ? `${Math.round(layer.sector_persistence * 100)}%`
      : null;
  const rank1 =
    typeof layer.sector_rank_1d === "number" && Number.isFinite(layer.sector_rank_1d)
      ? `1d rank ${(layer.sector_rank_1d * 100).toFixed(0)}%`
      : null;
  const rank5 =
    typeof layer.sector_rank_5d === "number" && Number.isFinite(layer.sector_rank_5d)
      ? `5d rank ${(layer.sector_rank_5d * 100).toFixed(0)}%`
      : null;
  const sessions = layer.sector_daily_sessions ?? [];

  return (
    <div
      className="mt-2 space-y-2 rounded-md px-3 py-2"
      style={{ border: `1px solid ${colors.border}`, background: "rgba(148,163,184,0.06)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {st ? (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{
              border: `1px solid ${st === "resolved" ? "rgba(34,197,94,0.45)" : "rgba(148,163,184,0.45)"}`,
              background: st === "resolved" ? "rgba(34,197,94,0.1)" : "rgba(148,163,184,0.1)",
              color: st === "resolved" ? colors.bullish : colors.textMuted
            }}
          >
            {sectorResolutionLabel(st)}
          </span>
        ) : null}
        {layer.sector_data_available === false && st === "pending_cache_refresh" ? (
          <span className="text-xs text-muted-foreground">
            Excluded from composite score and alignment until cache is ready — not a system error.
          </span>
        ) : layer.sector_data_available === false ? (
          <span className="text-xs text-muted-foreground">Sector momentum data not available for this read.</span>
        ) : null}
        {layer.sector_trending ? (
          <span className="text-xs text-muted-foreground capitalize">Trend: {layer.sector_trending}</span>
        ) : null}
      </div>
      {lead != null || pers != null ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>
          {lead != null ? (
            <>
              <strong style={{ color: colors.text }}>{lead}</strong> sessions vs SPY
            </>
          ) : null}
          {lead != null && pers != null ? " · " : null}
          {pers != null ? (
            <>
              persistence <strong style={{ color: colors.text }}>{pers}</strong>
            </>
          ) : null}
        </p>
      ) : null}
      {(rank1 || rank5) && (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>
          {[rank1, rank5].filter(Boolean).join(" · ")}
        </p>
      )}
      {interp ? (
        <span
          className="inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{
            border: `1px solid rgba(59,130,246,0.42)`,
            background: "rgba(59,130,246,0.1)",
            color: colors.accent
          }}
        >
          {interp}
        </span>
      ) : null}
      {sessions.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Recent vs SPY (cached)</div>
          <ul className="m-0 grid list-none gap-1 p-0" style={{ fontSize: typography.scale.xs }}>
            {sessions.slice(-5).map((s: SectorDailySessionWire) => (
              <li key={s.date} className="flex justify-between gap-2 tabular-nums text-muted-foreground">
                <span>{s.date}</span>
                <span style={{ color: s.outperformed ? colors.bullish : colors.textMuted }}>
                  {s.relative >= 0 ? "+" : ""}
                  {s.relative.toFixed(2)}%
                  {s.outperformed ? " · outperform" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function rrMarkerPct(rr: number): number {
  const clamped = Math.max(0.5, Math.min(3.5, rr));
  return ((clamped - 0.5) / 3.0) * 100;
}

/** VWAP chips from the technical layer — always non-empty server copy. */
function technicalVwapChipPresentation(
  point: string,
  colors: ThemeColors
): { skip: boolean; chipStyle: CSSProperties; Icon?: LucideIcon } {
  const lower = point.toLowerCase();
  if (lower.includes("vwap") && lower.includes("— above")) {
    return {
      skip: false,
      chipStyle: {
        fontSize: typography.scale.xs,
        fontWeight: 600,
        border: "1px solid rgba(34,197,94,0.45)",
        background: "rgba(34,197,94,0.12)",
        color: colors.bullish
      },
      Icon: ArrowUp
    };
  }
  if (lower.includes("vwap") && lower.includes("— below")) {
    return {
      skip: false,
      chipStyle: {
        fontSize: typography.scale.xs,
        fontWeight: 600,
        border: "1px solid rgba(239,68,68,0.45)",
        background: "rgba(239,68,68,0.12)",
        color: colors.bearish
      },
      Icon: ArrowDown
    };
  }
  if (point === "VWAP Forming" || lower === "vwap forming") {
    return {
      skip: false,
      chipStyle: {
        fontSize: typography.scale.xs,
        fontWeight: 600,
        border: "1px solid rgba(245,158,11,0.45)",
        background: "rgba(245,158,11,0.14)",
        color: colors.caution
      },
      Icon: Clock
    };
  }
  if (point.startsWith("VWAP starts at") || point.startsWith("VWAP (RTH closed)")) {
    return {
      skip: false,
      chipStyle: {
        fontSize: typography.scale.xs,
        fontWeight: 600,
        border: `1px solid ${colors.border}`,
        background: "rgba(148,163,184,0.10)",
        color: colors.textMuted
      }
    };
  }
  return { skip: true, chipStyle: {} };
}

/** Distinct styling for session ORB chips on the technical layer (evidence modal). */
function technicalOrbChipPresentation(
  point: string,
  colors: ThemeColors
): { skip: boolean; chipStyle: CSSProperties; Icon?: LucideIcon } {
  const lower = point.toLowerCase();
  if (lower.includes("expired")) {
    return { skip: true, chipStyle: {} };
  }
  const baseFont = { fontSize: typography.scale.xs, fontWeight: 600 as const };
  if (point.startsWith("ORB Long")) {
    return {
      skip: false,
      chipStyle: {
        ...baseFont,
        border: "1px solid rgba(34,197,94,0.45)",
        background: "rgba(34,197,94,0.12)",
        color: colors.bullish
      },
      Icon: ArrowUp
    };
  }
  if (point.startsWith("ORB Short")) {
    return {
      skip: false,
      chipStyle: {
        ...baseFont,
        border: "1px solid rgba(239,68,68,0.45)",
        background: "rgba(239,68,68,0.12)",
        color: colors.bearish
      },
      Icon: ArrowDown
    };
  }
  if (point === "ORB Forming") {
    return {
      skip: false,
      chipStyle: {
        ...baseFont,
        border: "1px solid rgba(245,158,11,0.45)",
        background: "rgba(245,158,11,0.14)",
        color: colors.caution
      },
      Icon: Clock
    };
  }
  if (point.startsWith("Inside ORB")) {
    return {
      skip: false,
      chipStyle: {
        ...baseFont,
        border: "1px solid rgba(148,163,184,0.4)",
        background: "rgba(148,163,184,0.12)",
        color: colors.textMuted
      },
      Icon: AlignJustify
    };
  }
  return {
    skip: false,
    chipStyle: {
      fontSize: typography.scale.xs,
      border: `1px solid ${colors.border}`,
      color: colors.textMuted
    }
  };
}

function confluenceChips(evidence: SignalEvidenceData, insight: SignalEvidenceInsight) {
  const yes =
    evidence.confluence?.confirming_signals?.length ? evidence.confluence.confirming_signals : insight.confirming_signals;
  const no =
    evidence.confluence?.conflicting_signals?.length ? evidence.confluence.conflicting_signals : insight.conflicting_signals;
  return { yes, no };
}

const CATALYST_TITLE_MAX = 80;

function truncateCatalystTitle(text: string): string {
  const t = text.trim();
  if (t.length <= CATALYST_TITLE_MAX) return t;
  return `${t.slice(0, CATALYST_TITLE_MAX).trimEnd()}…`;
}

function formatCatalystSource(source: string | undefined): string {
  const s = source?.trim();
  if (!s) return "News";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatSentimentScore(score: number): string {
  if (!Number.isFinite(score)) return "";
  return score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2);
}

function formatGeoEventTypeLabel(et: string): string {
  return et.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Avoid chip/semiconductor-heavy theme copy when the mapped sector is not tech-adjacent. */
function scrubGeoCopyForDisplay(body: string, sectorLabel: string): string {
  const t = body.trim();
  if (!t) return body;
  const s = sectorLabel.trim();
  const techish =
    /semi|software|chip|cloud|saas|hardware|internet|tech|communication|network|digital/i.test(s);
  if (techish) return body;
  if (/semiconductor|chip ban|export controls?|foundry|wafer/i.test(t)) {
    return "No elevated geopolitical sensitivity detected for this company.";
  }
  return body;
}

function geoExposureBandStyles(
  band: "low" | "moderate" | "high" | null,
  colors: ThemeColors
): { bg: string; fg: string; border: string } {
  if (band === "high") return { bg: "rgba(239,68,68,0.10)", fg: colors.bearish, border: "rgba(239,68,68,0.38)" };
  if (band === "moderate") return { bg: "rgba(245,158,11,0.12)", fg: colors.caution, border: "rgba(245,158,11,0.42)" };
  if (band === "low") return { bg: "rgba(34,197,94,0.09)", fg: colors.bullish, border: "rgba(34,197,94,0.38)" };
  return { bg: "rgba(148,163,184,0.10)", fg: colors.textMuted, border: colors.border };
}

function formatSectorMultiplier(m: number | null): string {
  if (m == null || !Number.isFinite(m)) return "—";
  const rounded = Math.round(m * 100) / 100;
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
  return `${s}×`;
}

function GeoStructuralBaselinePanel({ geo, colors }: { geo: GeopoliticalLayerExtras; colors: ThemeColors }) {
  const band = structuralBandFromBaselineScore(geo.geoBaselineScore ?? null) ?? geo.exposureBand;
  const rawBody = (geo.geoBaselineSummary ?? geo.exposureSummary ?? "").trim();
  const body = scrubGeoCopyForDisplay(rawBody, geo.impactSectorLabel ?? "");
  const sector = geo.impactSectorLabel;
  const themeChip =
    geo.geoPrimaryTheme && geo.geoPrimaryTheme.length ? geo.geoPrimaryTheme.replace(/_/g, " ") : "";
  const baselineBadge =
    band === "high" ? "Background sensitivity" : band === "moderate" ? "Structural context" : "Baseline exposure";

  return (
    <div
      style={{
        marginTop: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: "1px solid rgba(148,163,184,0.3)",
        background: "linear-gradient(180deg, rgba(51,65,85,0.18), rgba(15,23,42,0.14))",
        boxShadow: "0 0 0 1px rgba(148,163,184,0.08), 0 0 18px rgba(15,23,42,0.24)",
        display: "grid",
        gap: spacing[2]
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 700,
            letterSpacing: "0.055em",
            color: colors.textMuted
          }}
        >
          Structural exposure
        </span>
        {band ? (
          <span
            style={{
              fontSize: typography.scale.xs,
              fontWeight: 600,
              color: colors.textMuted,
              padding: "3px 10px",
              borderRadius: borderRadius.full,
              border: "1px solid rgba(148,163,184,0.3)",
              background: "rgba(148,163,184,0.12)"
            }}
          >
            {baselineBadge}
          </span>
        ) : null}
      </div>
      {themeChip ? (
        <span
          className="w-fit rounded-full px-3 py-1 text-xs font-semibold"
          style={{ border: `1px solid ${colors.border}`, color: colors.text }}
        >
          {sector && sector !== "Sector unknown" ? `${sector} · ${themeChip}` : themeChip}
        </span>
      ) : null}
      {body ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.55 }}>
          {body}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
        Background sensitivity, not an active event.
      </p>
      <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
        Structural baseline — no active geo escalation in the current window.
      </p>
      <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
        Structural exposure informs position sizing and confidence — not entry timing.
      </p>
    </div>
  );
}

function GeopoliticalExposurePanel({ geo, colors }: { geo: GeopoliticalLayerExtras; colors: ThemeColors }) {
  const bandSt = geoExposureBandStyles(geo.exposureBand, colors);
  return (
    <div
      style={{
        marginTop: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${bandSt.border}`,
        background: bandSt.bg,
        display: "grid",
        gap: spacing[2]
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 700,
            letterSpacing: "0.055em",
            color: colors.textMuted
          }}
        >
          Stock geo exposure
        </span>
        {geo.exposureBand ? (
          <span
            style={{
              fontSize: typography.scale.xs,
              fontWeight: 700,
              textTransform: "capitalize",
              color: bandSt.fg,
              padding: "3px 10px",
              borderRadius: borderRadius.full,
              border: `1px solid ${bandSt.border}`,
              background: "rgba(255,255,255,0.04)"
            }}
          >
            {geo.exposureBand}
          </span>
        ) : null}
      </div>
      <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.45 }}>
        <strong>{geo.impactSectorLabel}</strong>
        {geo.eventDetails.length > 0 ? (
          <span style={{ color: colors.textMuted, fontWeight: 400 }}> · mapped sector vs headline themes</span>
        ) : null}
      </p>
      {geo.eventDetails.length > 0 ? (
        <ul
          style={{
            margin: 0,
            paddingLeft: "1.15rem",
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            display: "grid",
            gap: spacing[1],
            listStyleType: "disc"
          }}
        >
          {geo.eventDetails.map((row) => (
            <li key={row.event_type} style={{ lineHeight: 1.5 }}>
              <span style={{ color: colors.text }}>{formatGeoEventTypeLabel(row.event_type)}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}> · intensity {row.score.toFixed(2)}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: bandSt.fg }}> · {formatSectorMultiplier(row.sector_multiplier)}</span>
              <span style={{ fontSize: typography.scale.xs, opacity: 0.88 }}> for this sector</span>
            </li>
          ))}
        </ul>
      ) : null}
      {geo.stockExposureScore != null ? (
        <p
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            fontVariantNumeric: "tabular-nums"
          }}
        >
          Weighted score:{" "}
          <strong style={{ color: colors.text }}>{geo.stockExposureScore.toFixed(2)}</strong>
        </p>
      ) : null}
      {geo.exposureSummary ? (
        <p
          style={{
            margin: 0,
            fontSize: typography.scale.sm,
            lineHeight: 1.55,
            color: colors.text,
            borderTop: `1px solid ${colors.border}`,
            paddingTop: spacing[2]
          }}
        >
          {scrubGeoCopyForDisplay(geo.exposureSummary, geo.impactSectorLabel ?? "")}
        </p>
      ) : null}
    </div>
  );
}

export function SignalEvidenceCard({ evidence, onOpenNewsPanel }: SignalEvidenceCardProps) {
  const { colors } = useTheme();
  const isMobileLayout = useIsMobileLayout();
  const hasAIExplanations = useHasAIExplanations();
  const profileLoaded = useUserProfileLoaded();
  const [captureEx, setCaptureEx] = useState<{
    text: string;
    source: "ai" | "deterministic";
    upgrade: boolean;
    cached: boolean;
  } | null>(null);
  const insight = evidence.insight ?? deriveEvidenceInsightFallback(evidence);

  useEffect(() => {
    let cancelled = false;
    const sym = evidence.symbol.trim().toUpperCase();
    const topLayers = evidence.layers.slice(0, 4).map((l) => ({
      layer: l.key,
      status: l.status,
      score: l.contributionScore
    }));
    void (async () => {
      try {
        const res = await fetch("/api/stocvest/signals/ai/explanations", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "signal_capture",
            symbol: sym,
            score: insight.signal_score,
            verdict: evidence.direction,
            risk_reward: insight.risk_reward,
            top_layers: topLayers
          })
        });
        if (!res.ok) throw new Error("explanation request failed");
        const j = (await res.json()) as {
          text?: string;
          source?: string;
          upgrade_available?: boolean;
          cached?: boolean;
        };
        if (cancelled) return;
        setCaptureEx({
          text: String(j.text || ""),
          source: j.source === "ai" ? "ai" : "deterministic",
          upgrade: Boolean(j.upgrade_available),
          cached: Boolean(j.cached)
        });
      } catch {
        if (!cancelled) setCaptureEx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    evidence.symbol,
    evidence.direction,
    evidence.layers,
    insight.signal_score,
    insight.risk_reward,
    evidence.updatedAtIso
  ]);

  const captureDisplayText = captureEx?.text && captureEx.text.length > 0 ? captureEx.text : evidence.aiVerdict;
  const captureCachedFlag = Boolean(captureEx?.cached);
  const showUpgradeAfterCapture =
    Boolean(captureEx?.upgrade) || (profileLoaded && !hasAIExplanations && captureEx !== null);
  const directionTone =
    evidence.direction === "bullish" ? colors.bullish : evidence.direction === "bearish" ? colors.bearish : colors.caution;
  const { yes: confYes, no: confNo } = confluenceChips(evidence, insight);
  const showConfluencePanel = confYes.length > 0 || confNo.length > 0;
  const geopoliticalDragActive = evidence.layers.some(
    (l) =>
      l.key === "geopolitical" &&
      l.geo != null &&
      (l.geo.geoHasLiveEvents === true || (l.geo.activeEvents?.length ?? 0) > 0) &&
      l.geo.exposureBand !== "low"
  );
  const verdictReconcilerText = buildVerdictTagReconciler(
    evidence.direction,
    confYes,
    confNo,
    geopoliticalDragActive
  );
  const tradeDecision = synthTradeDecision(evidence, insight);
  const riskReinforcementBullets = tradeDecision.reinforcements;
  const readinessTone: CardTone =
    tradeDecision.state === "actionable" ? "bullish" : tradeDecision.state === "blocked" ? "bearish" : "caution";
  const trendTone: CardTone =
    insight.trend_strength.toLowerCase() === "strong"
      ? "bullish"
      : insight.trend_strength.toLowerCase() === "weak"
        ? "bearish"
        : "caution";
  const rrTone: CardTone = insight.risk_reward >= 2.5 ? "bullish" : insight.risk_reward < 1.5 ? "bearish" : "caution";
  const regimeTone: CardTone =
    insight.market_regime.toLowerCase() === "bullish"
      ? "bullish"
      : insight.market_regime.toLowerCase() === "bearish"
        ? "bearish"
        : "caution";
  const alignmentTone: CardTone =
    evidence.alignment?.level === "full" || evidence.alignment?.level === "strong"
      ? "bullish"
      : evidence.alignment?.level === "conflict"
        ? "bearish"
        : "caution";
  const entryZone =
    insight.historical_entry_zone ??
    (typeof evidence.keyLevels.support === "number" && typeof evidence.keyLevels.resistance === "number"
      ? { low: evidence.keyLevels.support, high: evidence.keyLevels.resistance }
      : null);
  const rt1 = insight.reference_target_1 ?? evidence.keyLevels.resistance ?? null;
  const rt2 = insight.reference_target_2 ?? (typeof evidence.keyLevels.resistance === "number" ? evidence.keyLevels.resistance * 1.012 : null);
  const stopLvl = insight.reference_stop_level ?? evidence.keyLevels.support ?? null;
  const vwap = insight.vwap ?? evidence.keyLevels.vwap ?? null;
  const lastPrice =
    typeof evidence.lastTradePrice === "number" && Number.isFinite(evidence.lastTradePrice) && evidence.lastTradePrice > 0
      ? evidence.lastTradePrice
      : null;
  const vwapRow = getVWAPDisplay(
    vwap,
    insight.vwap_state ?? evidence.keyLevels.vwap_state,
    lastPrice,
    insight.vwap_display ?? evidence.keyLevels.vwap_display,
    insight.vwap_tooltip ?? evidence.keyLevels.vwap_tooltip
  );
  const levelsComplete = Boolean(entryZone && rt1 != null && stopLvl != null);

  return (
    <article style={{ display: "grid", gap: spacing[4], position: "relative", paddingBottom: spacing[4] }}>
      {evidence.earningsRisk ? (
        <section
          style={{
            border: "1px solid rgba(245,158,11,0.5)",
            background: "rgba(245,158,11,0.14)",
            borderRadius: borderRadius.lg,
            padding: spacing[3]
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, color: colors.caution }}>
            ⚠️ Earnings Risk: {evidence.symbol} reports earnings in {evidence.earningsRisk.daysUntil} day
            {evidence.earningsRisk.daysUntil === 1 ? "" : "s"} (
            {evidence.earningsRisk.reportTime === "before_market"
              ? "before market"
              : evidence.earningsRisk.reportTime === "after_market"
                ? "after market close"
                : evidence.earningsRisk.reportTime === "during_market"
                  ? "during market"
                  : "timing TBD"}
            )
          </p>
          <p style={{ margin: `${spacing[1]} 0 0 0`, color: colors.textMuted }}>
            All signals carry additional uncertainty until after the earnings report. Signal parameters show elevated event risk —
            size and timing are solely your decision.
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-xl sm:text-2xl" style={{ margin: 0 }}>
              {evidence.symbol}
            </h2>
            <span
              style={{
                borderRadius: borderRadius.full,
                padding: "4px 10px",
                fontSize: typography.scale.xs,
                fontWeight: 700,
                background: "rgba(148,163,184,0.14)",
                color: directionTone
              }}
            >
              {evidence.directionBadgeLabel}
            </span>
            <span
              style={{
                borderRadius: borderRadius.full,
                padding: "4px 10px",
                fontSize: typography.scale.xs,
                fontWeight: 700,
                letterSpacing: "0.04em",
                background: "rgba(59,130,246,0.12)",
                color: colors.textMuted
              }}
            >
              NOT INVESTMENT ADVICE
            </span>
            {geopoliticalDragActive ? (
              <span
                data-testid="geopolitical-drag-badge"
                title="Elevated geopolitical headlines are weighing on the composite read for this symbol's sector."
                style={{
                  borderRadius: borderRadius.full,
                  padding: "4px 10px",
                  fontSize: typography.scale.xs,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  background: "rgba(239,68,68,0.12)",
                  color: colors.bearish,
                  border: `1px solid rgba(239,68,68,0.45)`
                }}
              >
                GEOPOLITICAL DRAG
              </span>
            ) : null}
          </div>
          {evidence.compositeMode === "swing" || evidence.signal_basis === "daily_bars_rth" ? (
            <div className="text-xs text-muted-foreground tracking-wide">
              {evidence.signal_basis_label?.trim() || "Derived from daily bars (RTH)"}
            </div>
          ) : null}
        </div>
        <span className="text-sm" style={{ color: colors.textMuted }}>
          {displayUpdatedLabel(evidence)}
        </span>
      </section>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div
          style={{
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[1],
            ...elevatedCardStyle(colors, readinessTone)
          }}
        >
          <span style={{ fontSize: typography.scale.xs, fontWeight: 700, letterSpacing: "0.06em", color: colors.textMuted }}>
            TRADE READINESS
          </span>
          <span
            className="text-3xl font-bold tabular-nums sm:text-4xl"
            style={{ color: scoreHeaderColor(insight.signal_score, colors), lineHeight: 1.1 }}
          >
            <DecisionMetric explanation={compositeSignalScoreTooltip(insight.signal_score)} label="How trade readiness is used" maxWidth={300}>
              <span>
                {insight.signal_score}
                <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, fontWeight: 600 }}> / 100</span>
              </span>
            </DecisionMetric>
          </span>
          <span className="inline-flex items-center gap-1 text-xs" style={{ color: colors.textMuted }}>
            Composite read
            <InfoTip text={CONFIDENCE_PERCENT_TIP} label="Scanner vs composite score detail" />
          </span>
          <p
            style={{
              margin: 0,
              fontSize: typography.scale.xs,
              color: decisionLineColor(tradeDecision.state, colors),
              fontWeight: 600,
              lineHeight: 1.45
            }}
          >
            {tradeDecision.line}
          </p>
          {insight.is_complete === false ? (
            <span style={{ color: colors.caution, fontSize: typography.scale.xs, fontWeight: 700 }}>Incomplete</span>
          ) : null}
        </div>
        <div
          style={{
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[1],
            ...elevatedCardStyle(colors, trendTone)
          }}
        >
          <span style={{ fontSize: typography.scale.xs, fontWeight: 700, letterSpacing: "0.06em", color: colors.textMuted }}>
            TREND STRENGTH
          </span>
          <span className="text-xl font-bold sm:text-2xl" style={{ color: trendStrengthColor(insight.trend_strength, colors) }}>
            <DecisionMetric explanation={trendStrengthDecisionTooltip(insight.trend_strength)} label="How trend strength is used" maxWidth={300}>
              <span>{insight.trend_strength}</span>
            </DecisionMetric>
          </span>
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{insight.trend_direction}</span>
        </div>
        <div
          style={{
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[1],
            ...elevatedCardStyle(colors, rrTone)
          }}
        >
          <span style={{ fontSize: typography.scale.xs, fontWeight: 700, letterSpacing: "0.06em", color: colors.textMuted }}>
            RISK / REWARD
          </span>
          <span className="text-xl font-bold tabular-nums sm:text-2xl" style={{ color: rrChipColor(insight.risk_reward, colors) }}>
            <DecisionMetric
              explanation={riskRewardEntryDecisionTooltip(insight.risk_reward, { incomplete: insight.is_complete === false })}
              label="How entry risk/reward is used"
              maxWidth={320}
            >
              <span>{insight.risk_reward.toFixed(1)}:1</span>
            </DecisionMetric>
          </span>
          {insight.rr_warning ? (
            <span style={{ color: colors.caution, fontSize: typography.scale.xs, fontWeight: 700 }}>Low R/R - below 2:1</span>
          ) : null}
          {insight.rr_quality ? (
            <span style={{ color: colors.textMuted, fontSize: typography.scale.xs, textTransform: "capitalize" }}>
              R/R quality: {insight.rr_quality}
            </span>
          ) : null}
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Entry R/R</span>
          <div
            style={{
              position: "relative",
              height: 8,
              borderRadius: borderRadius.full,
              background: "linear-gradient(90deg, rgba(239,68,68,0.85), rgba(245,158,11,0.7), rgba(34,197,94,0.9))",
              marginTop: 4
            }}
          >
            <span
              style={{
                position: "absolute",
                top: -2,
                width: 4,
                height: 12,
                borderRadius: 2,
                background: colors.text,
                left: `calc(${rrMarkerPct(insight.risk_reward)}% - 2px)`,
                boxShadow: "0 0 0 2px rgba(15,23,42,0.35)"
              }}
            />
          </div>
        </div>
        <div
          style={{
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[1],
            ...elevatedCardStyle(colors, regimeTone)
          }}
        >
          <span style={{ fontSize: typography.scale.xs, fontWeight: 700, letterSpacing: "0.06em", color: colors.textMuted }}>
            MARKET REGIME
          </span>
          <span className="text-xl font-bold sm:text-2xl" style={{ color: regimeColor(insight.market_regime, colors) }}>
            <DecisionMetric explanation={marketRegimeDecisionTooltip(insight.market_regime)} label="How market regime is used" maxWidth={300}>
              <span>{insight.market_regime}</span>
            </DecisionMetric>
          </span>
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Macro / regime layer</span>
        </div>
      </section>

      {tradeDecision.rationale ? (
        <section
          aria-label="Decision rationale"
          style={{
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            ...elevatedCardStyle(
              colors,
              tradeDecision.state === "blocked" ? "bearish" : "caution"
            )
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: typography.scale.sm,
              color: colors.text,
              lineHeight: 1.55
            }}
          >
            <strong style={{ color: decisionLineColor(tradeDecision.state, colors) }}>
              {tradeDecision.rationale.label}
            </strong>{" "}
            {tradeDecision.rationale.text}
          </p>
        </section>
      ) : null}

      {(evidence.alignment != null ||
        (insight.alignment_ratio != null && Number.isFinite(insight.alignment_ratio)) ||
        (insight.conflicted_layers != null && insight.conflicted_layers.length > 0)) ? (
        <section
          style={{
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "grid",
            gap: spacing[2],
            ...elevatedCardStyle(colors, alignmentTone)
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: typography.scale.sm,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: colors.textMuted
            }}
          >
            LAYER ALIGNMENT
          </h3>
          {evidence.alignment ? (
            <div style={{ display: "grid", gap: spacing[2] }}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-bold"
                  style={{
                    border: `1px solid ${alignmentAccent(evidence.alignment.level, colors)}`,
                    color: alignmentAccent(evidence.alignment.level, colors),
                    background: "rgba(148,163,184,0.08)"
                  }}
                >
                  {evidence.alignment.chip}
                </span>
                <span className="text-xs font-semibold text-muted-foreground">{evidence.alignment.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  Score adj:{" "}
                  <strong style={{ color: evidence.alignment.score_modifier >= 0 ? colors.bullish : colors.bearish }}>
                    {evidence.alignment.score_modifier >= 0 ? "+" : ""}
                    {evidence.alignment.score_modifier}
                  </strong>
                </span>
              </div>
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.5 }}>{evidence.alignment.detail}</p>
              <div className="flex flex-wrap gap-3" style={{ fontSize: typography.scale.xs }}>
                {(
                  [
                    ["Macro", evidence.alignment.macro_supports, evidence.alignment.macro_direction],
                    ["Sector", evidence.alignment.sector_supports, evidence.alignment.sector_direction],
                    ["Technical", evidence.alignment.technical_supports, evidence.alignment.technical_direction]
                  ] as const
                ).map(([label, supports, dir]) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span
                      title={supports ? "Supports direction" : "Does not support direction"}
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: supports ? colors.bullish : colors.textMuted,
                        opacity: supports ? 1 : 0.35
                      }}
                    />
                    <span className="text-muted-foreground">{label}:</span>
                    <span style={{ fontWeight: 600, color: colors.text }}>{formatDirShort(dir)}</span>
                  </div>
                ))}
              </div>
              {evidence.alignment.is_counter_trend ? (
                <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.caution, fontWeight: 600 }}>
                  Counter-trend vs macro or sector — size and risk accordingly.
                </p>
              ) : null}
            </div>
          ) : null}
          {insight.alignment_ratio != null && Number.isFinite(insight.alignment_ratio) ? (
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text }}>
              <strong style={{ color: colors.text }}>Agreement:</strong>{" "}
              {Math.round(insight.alignment_ratio * 100)}% of weighted layers align with the composite direction.
            </p>
          ) : null}
          {insight.conflicted_layers && insight.conflicted_layers.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {insight.conflicted_layers.map((key) => (
                <span
                  key={key}
                  style={{
                    borderRadius: borderRadius.full,
                    padding: "4px 10px",
                    fontSize: typography.scale.xs,
                    border: `1px solid ${colors.caution}`,
                    background: "rgba(245,158,11,0.1)",
                    color: colors.caution,
                    fontWeight: 600,
                    textTransform: "lowercase"
                  }}
                >
                  {key}: divergent
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <h3 style={{ marginTop: 0 }}>Signal Layer Breakdown</h3>
        <div style={{ display: "grid", gap: spacing[3] }}>
          {evidence.layers.map((layer) => (
            <article
              key={layer.key}
              style={{
                borderRadius: borderRadius.lg,
                padding: spacing[3],
                display: "grid",
                gap: spacing[2],
                ...elevatedCardStyle(colors, toneFromStatus(layer.status))
              }}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span>{layer.icon}</span>
                  <strong className="inline-flex items-center gap-1.5 text-sm sm:text-base">
                    {layer.name}
                    <InfoTip text={LAYER_NAME_HINTS[layer.key] || "Signal layer readout."} label={layer.name} />
                  </strong>
                </div>
                <span
                  className="w-fit text-sm"
                  style={{
                    borderRadius: borderRadius.full,
                    padding: "2px 8px",
                    background: "rgba(148,163,184,0.15)",
                    color: statusColor(layer.status, colors)
                  }}
                >
                  {layer.status}
                </span>
              </div>
              <p className="text-sm leading-relaxed sm:text-base" style={{ margin: 0, color: colors.textMuted }}>
                {layer.explanation}
              </p>
              {layer.key === "macro" ? (
                <div className="flex flex-col gap-2">
                  {layer.macro_risk_level === "critical" && (layer.macro_warnings?.length ?? 0) > 0 ? (
                    <div className="mb-1 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
                      <div className="text-sm font-medium text-red-400">⚠️ High-Impact Event Imminent</div>
                      {(layer.macro_warnings ?? []).map((w, i) => (
                        <div key={i} className="mt-0.5 text-xs text-red-300">
                          {w}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {layer.macro_risk_level === "elevated" && (layer.macro_warnings?.length ?? 0) > 0 ? (
                    <div className="mb-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <div className="text-sm font-medium text-amber-400">⚠️ Macro Event Today</div>
                      {(layer.macro_warnings ?? []).map((w, i) => (
                        <div key={i} className="mt-0.5 text-xs text-amber-300">
                          {w}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {layer.yield_curve ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Yield curve:</span>
                      <span
                        className={`text-xs font-medium ${
                          layer.yield_curve.regime === "normal"
                            ? "text-green-400"
                            : layer.yield_curve.regime === "flat"
                              ? "text-amber-400"
                              : "text-red-400"
                        }`}
                      >
                        {layer.yield_curve.label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        (2yr {layer.yield_curve.yield_2yr.toFixed(2)}% / 10yr {layer.yield_curve.yield_10yr.toFixed(2)}%)
                      </span>
                    </div>
                  ) : null}
                  {(layer.upcoming_events?.length ?? 0) > 0 ? (
                    <div className="mt-1 space-y-1">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Upcoming</div>
                      {(layer.upcoming_events ?? []).slice(0, 3).map((ev) => (
                        <div key={ev.event_id} className="flex items-center justify-between text-xs">
                          <span
                            className={
                              ev.status === "imminent"
                                ? "font-medium text-red-400"
                                : ev.status === "today"
                                  ? "text-amber-400"
                                  : "text-muted-foreground"
                            }
                          >
                            {ev.name}
                          </span>
                          <span className="text-muted-foreground">
                            {ev.status === "imminent"
                              ? `${Math.round(ev.hours_until * 60)}m`
                              : ev.status === "today"
                                ? "Today"
                                : `${Math.round(ev.hours_until / 24)}d`}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {(layer.key === "technical" && evidence.compositeMode === "swing"
                  ? filterChipsForMode(sanitizeEvidenceChips(layer.keyPoints), "swing")
                  : sanitizeEvidenceChips(layer.keyPoints)
                )
                  .filter((p) => !p.toLowerCase().includes("expired"))
                  .map((point, idx) => {
                    let pres =
                      layer.key === "technical"
                        ? technicalVwapChipPresentation(point, colors)
                        : { skip: true, chipStyle: {} as CSSProperties };
                    if (layer.key === "technical" && pres.skip) {
                      pres = technicalOrbChipPresentation(point, colors);
                    }
                    if (layer.key !== "technical") {
                      pres = {
                        skip: false,
                        chipStyle: {
                          fontSize: typography.scale.xs,
                          border: `1px solid ${colors.border}`,
                          color: colors.textMuted
                        } as CSSProperties
                      };
                    }
                    if (pres.skip) return null;
                    const Icon = layer.key === "technical" ? pres.Icon : undefined;
                    const merged: CSSProperties = {
                      borderRadius: borderRadius.full,
                      padding: "2px 8px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      ...pres.chipStyle
                    };
                    return (
                      <span key={`${layer.key}-${idx}`} style={merged}>
                        {Icon ? <Icon className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden /> : null}
                        {point}
                      </span>
                    );
                  })}
              </div>
              {layer.key === "news" ? (
                <div style={{ display: "grid", gap: spacing[2] }}>
                  {layer.wim_summary ? (
                    <div className="mt-2 text-sm italic text-muted-foreground">
                      &ldquo;{layer.wim_summary}&rdquo;
                      <span className="ml-2 text-xs not-italic opacity-70">&mdash; Benzinga editorial</span>
                    </div>
                  ) : null}
                  {layer.latest_rating &&
                  ["upgrade", "downgrade", "initiates"].includes(layer.latest_rating.action.toLowerCase()) ? (
                    <span
                      className="inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold"
                      style={{
                        border: `1px solid ${
                          layer.latest_rating.action.toLowerCase().includes("downgrade")
                            ? "rgba(239,68,68,0.5)"
                            : "rgba(34,197,94,0.5)"
                        }`,
                        background:
                          layer.latest_rating.action.toLowerCase().includes("downgrade") ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)",
                        color: layer.latest_rating.action.toLowerCase().includes("downgrade") ? colors.bearish : colors.bullish
                      }}
                    >
                      {layer.latest_rating.firm}: {layer.latest_rating.action}
                      {layer.latest_rating.rating ? ` (${layer.latest_rating.rating})` : ""}
                    </span>
                  ) : null}
                  {layer.earnings_result && layer.earnings_result.beat !== null ? (
                    <span
                      className="inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold"
                      style={{
                        border: `1px solid ${layer.earnings_result.beat ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"}`,
                        background: layer.earnings_result.beat ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                        color: layer.earnings_result.beat ? colors.bullish : colors.bearish
                      }}
                    >
                      {layer.earnings_result.beat ? "Beat" : "Missed"} EPS{" "}
                      {typeof layer.earnings_result.eps_surprise_pct === "number" && Number.isFinite(layer.earnings_result.eps_surprise_pct)
                        ? `${layer.earnings_result.eps_surprise_pct > 0 ? "+" : ""}${layer.earnings_result.eps_surprise_pct.toFixed(1)}%`
                        : ""}
                    </span>
                  ) : null}
                  {layer.latest_guidance && (layer.latest_guidance.type === "raised" || layer.latest_guidance.type === "lowered") ? (
                    <span
                      className="inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold"
                      style={{
                        border: `1px solid ${layer.latest_guidance.type === "raised" ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"}`,
                        background: layer.latest_guidance.type === "raised" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                        color: layer.latest_guidance.type === "raised" ? colors.bullish : colors.bearish
                      }}
                    >
                      {layer.latest_guidance.type === "raised" ? "Guidance raised" : "Guidance cut"}
                    </span>
                  ) : null}
                  {layer.news_data_state === "stale" && (layer.articles_count === 0 || layer.articles_count === undefined) ? (
                    <p className="text-sm text-muted-foreground" style={{ margin: 0 }}>
                      {pickNewsEmptyCopy(evidence.symbol)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {layer.key === "news" && onOpenNewsPanel ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="border-0 bg-transparent p-0 text-xs font-semibold underline-offset-2 hover:underline"
                    style={{ color: colors.accent, cursor: "pointer" }}
                    onClick={() => onOpenNewsPanel(evidence.symbol)}
                  >
                    View all news for {evidence.symbol} →
                  </button>
                </div>
              ) : null}
              {layer.key === "sector" && sectorLayerHasMomentumDetails(layer) ? (
                <SectorMomentumPanel layer={layer} colors={colors} />
              ) : null}
              {layer.key === "geopolitical" && layer.geo ? (
                (layer.geo.activeEvents?.length ?? 0) > 0 || layer.geo.geoHasLiveEvents ? (
                  <GeopoliticalExposurePanel geo={layer.geo} colors={colors} />
                ) : (
                  <GeoStructuralBaselinePanel geo={layer.geo} colors={colors} />
                )
              ) : null}
              <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{displayLayerFreshness(layer, evidence)}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div style={{ display: "grid", gap: spacing[3] }}>
          <div
            style={{
              borderRadius: borderRadius.lg,
              padding: spacing[3],
              display: "grid",
              gap: spacing[2],
              ...elevatedCardStyle(colors)
            }}
          >
            <h3 style={{ margin: 0 }}>Reference Levels</h3>
            <p className="m-0 text-xs leading-snug text-muted-foreground" style={{ marginTop: spacing[1] }}>
              Reference levels (context, not entry signals)
            </p>
            {!levelsComplete ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.caution }}>
                Signal data incomplete - levels unavailable
              </p>
            ) : null}
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Historical Entry Zone: </strong>
              {entryZone ? `${formatLevel(entryZone.low)}–${formatLevel(entryZone.high)}` : "—"}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Reference Target 1: </strong>
              {formatLevel(rt1)}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Reference Target 2: </strong>
              {formatLevel(rt2)}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Reference Stop Level: </strong>
              {formatLevel(stopLvl)}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: typography.scale.sm,
                color: colors.textMuted,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 6
              }}
            >
              <strong style={{ color: colors.text }}>VWAP: </strong>
              <span
                className={vwapRow.muted ? "text-muted-foreground" : undefined}
                style={{
                  color:
                    vwapRow.state === VWAP_STATE.FORMING
                      ? colors.caution
                      : vwapRow.muted
                        ? colors.textMuted
                        : colors.text,
                  fontStyle: vwapRow.state === VWAP_STATE.PRE_MARKET && vwapRow.muted ? "italic" : undefined,
                  fontWeight: vwapRow.muted ? 500 : 600
                }}
              >
                {vwapRow.label}
              </span>
              <InfoTip text={vwapRow.tooltip} label="VWAP context" />
            </p>
            <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{displayUpdatedLabel(evidence)}</span>
          </div>

          {showConfluencePanel ? (
            <div
              style={{
                borderRadius: borderRadius.lg,
                padding: spacing[3],
                display: "grid",
                gap: spacing[2],
                ...elevatedCardStyle(colors)
              }}
            >
              <h3 style={{ margin: 0 }}>Confirming Signals</h3>
              <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>
                From confluence — signal data only, not investment advice.
              </p>
              <div className="flex flex-wrap gap-2">
                {confYes.map((c, i) => (
                  <span
                    key={`cf-yes-${i}-${c.label}`}
                    style={{
                      borderRadius: borderRadius.full,
                      padding: "4px 10px",
                      fontSize: typography.scale.xs,
                      fontWeight: 600,
                      border: `1px solid rgba(34,197,94,0.45)`,
                      background: "rgba(34,197,94,0.12)",
                      color: colors.bullish
                    }}
                  >
                    {c.label} ✓
                  </span>
                ))}
                {confNo.map((c, i) => (
                  <span
                    key={`cf-no-${i}-${c.label}`}
                    style={{
                      borderRadius: borderRadius.full,
                      padding: "4px 10px",
                      fontSize: typography.scale.xs,
                      fontWeight: 600,
                      border: `1px solid rgba(239,68,68,0.45)`,
                      background: "rgba(239,68,68,0.12)",
                      color: colors.bearish
                    }}
                  >
                    {c.label} ✗
                  </span>
                ))}
              </div>
              {verdictReconcilerText ? (
                <p
                  data-testid="verdict-tag-reconciler"
                  style={{
                    margin: 0,
                    fontSize: typography.scale.xs,
                    color: colors.textMuted,
                    lineHeight: 1.45,
                    fontStyle: "italic"
                  }}
                >
                  {verdictReconcilerText}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: spacing[3] }}>
          <div
            style={{
              borderRadius: borderRadius.lg,
              padding: spacing[3],
              display: "grid",
              gap: spacing[2],
              ...elevatedCardStyle(colors)
            }}
          >
            <h3 style={{ margin: 0 }}>Catalysts &amp; Context</h3>
            {insight.catalysts.length === 0 ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>No significant catalysts detected</p>
            ) : (
              <ul style={{ margin: 0, paddingInlineStart: 0, listStyle: "none", display: "grid", gap: spacing[3] }}>
                {insight.catalysts.slice(0, 3).map((c, i) => {
                  const sent = c.sentiment.toLowerCase();
                  const sentimentChip =
                    sent === "positive"
                      ? {
                          label: "Bullish",
                          fg: colors.bullish,
                          bg: "rgba(34,197,94,0.12)",
                          border: "1px solid rgba(34,197,94,0.45)"
                        }
                      : sent === "negative"
                        ? {
                            label: "Bearish",
                            fg: colors.bearish,
                            bg: "rgba(239,68,68,0.12)",
                            border: "1px solid rgba(239,68,68,0.45)"
                          }
                        : {
                            label: "Neutral",
                            fg: colors.caution,
                            bg: "rgba(245,158,11,0.1)",
                            border: "1px solid rgba(245,158,11,0.35)"
                          };
                  const scoreStr =
                    typeof c.sentiment_score === "number" && Number.isFinite(c.sentiment_score)
                      ? formatSentimentScore(c.sentiment_score)
                      : "";
                  const openNews = () => onOpenNewsPanel?.(evidence.symbol);
                  return (
                    <li key={`cat-${i}`} style={{ display: "grid", gap: spacing[1] }}>
                      <button
                        type="button"
                        className="text-left"
                        disabled={!onOpenNewsPanel}
                        onClick={openNews}
                        style={{
                          border: "none",
                          background: onOpenNewsPanel ? "rgba(59,130,246,0.08)" : "transparent",
                          borderRadius: borderRadius.md,
                          padding: spacing[2],
                          margin: 0,
                          cursor: onOpenNewsPanel ? "pointer" : "default",
                          display: "grid",
                          gap: spacing[1],
                          width: "100%"
                        }}
                        aria-label={onOpenNewsPanel ? `Open news drawer for ${evidence.symbol}` : undefined}
                      >
                      <span className="text-sm leading-snug" style={{ color: colors.text, fontWeight: 600 }}>
                        {truncateCatalystTitle(c.text)}
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          style={{
                            borderRadius: borderRadius.full,
                            padding: "2px 8px",
                            fontSize: typography.scale.xs,
                            fontWeight: 600,
                            border: `1px solid ${colors.border}`,
                            background: "rgba(148,163,184,0.12)",
                            color: colors.textMuted
                          }}
                        >
                          {formatCatalystSource(c.source)}
                        </span>
                        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{catalystPublishedAgo(c.published_at)}</span>
                        <span
                          style={{
                            borderRadius: borderRadius.full,
                            padding: "2px 8px",
                            fontSize: typography.scale.xs,
                            fontWeight: 700,
                            border: sentimentChip.border,
                            background: sentimentChip.bg,
                            color: sentimentChip.fg
                          }}
                        >
                          {sentimentChip.label}
                          {scoreStr ? ` ${scoreStr}` : ""}
                        </span>
                      </div>
                      {onOpenNewsPanel ? (
                        <span style={{ fontSize: 10, fontWeight: 600, color: colors.accent }}>Tap to open news →</span>
                      ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div
            style={{
              borderRadius: borderRadius.lg,
              padding: spacing[3],
              display: "grid",
              gap: spacing[2],
              ...elevatedCardStyle(colors, riskReinforcementBullets.length > 0 ? "caution" : "neutral")
            }}
          >
            <h3 style={{ margin: 0 }}>Risk Factors</h3>
            {riskReinforcementBullets.length === 0 && insight.risk_factors.length === 0 ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>No significant risk factors detected</p>
            ) : (
            <ul style={{ margin: 0, paddingInlineStart: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
              {(riskReinforcementBullets.length > 0 ? riskReinforcementBullets : insight.risk_factors.slice(0, 6)).map((r, i) => (
                <li key={`risk-${i}`} className="flex gap-2 text-sm" style={{ color: colors.text }}>
                  <span
                    style={{
                      marginTop: 6,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: colors.bearish,
                      flexShrink: 0
                    }}
                  />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
            )}
          </div>
        </div>
      </section>

      <section
        style={{
          borderRadius: borderRadius.lg,
          padding: spacing[3],
          display: "grid",
          gap: spacing[2],
          ...elevatedCardStyle(colors)
        }}
      >
        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: spacing[2] }}>
          <Brain size={18} />
          AI Signal Analysis
          <InfoTip text={AI_VERDICT_TIP} label="About AI signal analysis" />
        </h3>
        <AIExplanationDisplay
          text={captureDisplayText}
          source={captureEx ? captureEx.source : "deterministic"}
          cached={captureCachedFlag}
          colors={colors}
        />
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>Signal summary</span>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{evidence.aiFreshnessLabel}</span>
        {showUpgradeAfterCapture ? (
          <UpgradePrompt
            feature="AI Signal Explanations"
            plan="Swing Pro"
            description="Get plain-English explanations tailored to this specific setup and market context."
          />
        ) : null}
      </section>

      <section
        style={{
          borderRadius: borderRadius.lg,
          padding: spacing[3],
          display: "grid",
          gap: spacing[2],
          ...elevatedCardStyle(colors)
        }}
      >
        <h3 style={{ margin: 0 }}>Signal Parameters</h3>
        <p
          style={{
            margin: 0,
            borderLeft: "2px solid rgba(0,180,255,0.3)",
            paddingLeft: 16,
            fontSize: 13,
            lineHeight: 1.8,
            color: colors.text
          }}
        >
          {insight.signal_parameters}
        </p>
      </section>

      <div
        style={{
          background: "linear-gradient(180deg, rgba(59,130,246,0.08), rgba(148,163,184,0.08))",
          border: "1px solid rgba(59,130,246,0.24)",
          borderRadius: borderRadius.lg,
          padding: "12px 16px",
          fontSize: "12px",
          color: colors.textMuted,
          lineHeight: "1.6",
          marginBottom: "4px",
          boxShadow: "0 0 0 1px rgba(59,130,246,0.1), 0 0 20px rgba(37,99,235,0.08)"
        }}
      >
        <strong style={{ color: colors.accent }}>Signal Data Only</strong>
        <br />
        This analysis surfaces technical patterns and signal data for informational purposes. It is not investment advice. Reference
        levels shown are derived from historical patterns — not predictions. You are solely responsible for all trading decisions.
      </div>

      <section
        style={{
          borderRadius: borderRadius.lg,
          padding: spacing[3],
          display: "grid",
          gap: spacing[2],
          ...elevatedCardStyle(colors)
        }}
      >
        <h3 style={{ margin: 0 }}>Signal Strength Breakdown</h3>
        <div className="h-[208px] w-full max-w-full min-w-0 lg:h-[236px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={evidence.layers.map((l) => ({
                layer: l.name,
                score: Math.round(l.contributionScore),
                status: l.status
              }))}
              layout="vertical"
              margin={
                isMobileLayout
                  ? { top: 4, right: 8, left: 0, bottom: 8 }
                  : { top: 4, right: 14, left: 2, bottom: 4 }
              }
              barCategoryGap={isMobileLayout ? "14%" : "16%"}
            >
              <XAxis
                type="number"
                domain={[0, 100]}
                tick={{ fontSize: isMobileLayout ? 9 : 10, fill: colors.textMuted }}
                axisLine={{ stroke: colors.border }}
                tickLine={{ stroke: colors.border }}
              />
              <YAxis
                type="category"
                dataKey="layer"
                width={isMobileLayout ? 108 : 124}
                interval={0}
                tick={{ fontSize: isMobileLayout ? 9 : 10, fill: colors.textMuted }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.07)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const row = payload[0].payload as { layer: string; score: number; status: EvidenceStatus };
                  return (
                    <div
                      style={{
                        background: colors.surface,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        padding: "8px 10px",
                        fontSize: 12,
                        color: colors.text
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{row.layer}</div>
                      <div style={{ color: colors.textMuted, marginTop: 4 }}>
                        {row.status === "Unavailable"
                          ? "Unavailable"
                          : row.status === "As of close"
                            ? `As of close: ${row.score}`
                            : `Score: ${row.score}`}
                      </div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="score" radius={[0, 6, 6, 0]} maxBarSize={isMobileLayout ? 18 : 20} isAnimationActive={false}>
                {evidence.layers.map((l) => (
                  <Cell key={l.key} fill={statusColor(l.status, colors)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{evidence.newsFreshnessLabel}</span>
      </section>

      <footer style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing[2] }}>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{displayUpdatedLabel(evidence)}</span>
        <SignalDisclaimerChip />
      </footer>
    </article>
  );
}
