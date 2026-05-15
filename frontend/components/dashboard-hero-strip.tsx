"use client";

/**
 * Dashboard Hero Strip — Phase A1 of the dashboard redesign.
 *
 * A single horizontal glance band that sits ABOVE the three master cards
 * (Shared Context / Swing Desk / Day Desk) and answers the question
 * "what's the market doing right now?" in one screenful, in under a
 * second of reading.
 *
 * Four cells, equal visual weight:
 *   1. REGIME PILL       — large categorical badge + 1-line context
 *   2. VIX PULSE         — last level + session % + tiny inline sparkline
 *   3. BREADTH DOTS      — one dot per sector ETF, coloured by 5d sign,
 *                          + categorical label (Broad / Mixed / Narrow)
 *   4. RISK HORIZON      — category + soonest event line
 *
 * STRUCTURAL CONTRACT (must be preserved by any future edit):
 *
 *   1. The hero strip is NOT a `data-card-role` master card. The
 *      dashboard-role-color-language.test invariant
 *      "dashboard_has_exactly_three_master_cards_at_top_hierarchy_level"
 *      counts elements with `[data-card-role]` and expects EXACTLY 3
 *      (shared / swing / day). The hero strip therefore renders no
 *      role attribute, no role pill, no 4px borderLeft marker.
 *
 *   2. All four cells render data that ALREADY lives inside the
 *      Shared Context master card below — they are a GLANCE projection
 *      of the same data, not a new source of truth. If a future fix
 *      changes a derivation (e.g. classifyVolatility thresholds),
 *      both surfaces update together because they share the helper.
 *
 *   3. Mode Separation discipline — strictly environment-only. No
 *      swing-coded or day-coded language, no cross-mode score, no
 *      ranking, no recommendation. Hero strip speaks the same neutral
 *      vocabulary as Shared Context.
 *
 *   4. Mobile-first responsive — cells flex-wrap; each cell has a
 *      `min-width` floor so it stays readable at 375px. On viewports
 *      < `sm` (640px) the strip collapses to a single column.
 *
 * The Hero Strip is purely presentational; all classifiers live in
 * `shared-context-master-card.tsx` and are re-imported here.
 */

import { useMemo, type CSSProperties } from "react";
import { InfoTip } from "@/components/info-tip";
import { IndexSparkline } from "@/components/index-sparkline";
import { DashboardRealtime } from "@/components/dashboard-realtime";
import {
  classifyParticipation,
  classifyRiskHorizon,
  classifyVolatility,
  participationPlainLine,
  riskHorizonPlainLine,
  volatilityPlainLine,
  type ParticipationCategory,
  type RiskHorizonCategory,
  type VolatilityCategory
} from "@/components/shared-context-master-card";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { ThemeColors } from "@/lib/design-system";
import { type SnapshotPayload, vixSnapshotDisplayLevel } from "@/lib/api/market";
import type { EarningsEvent } from "@/lib/api/earnings";
import { earningsTimingLabel } from "@/lib/earnings-timing";
import {
  REGIME_BADGE_TIP,
  REGIME_WITHOUT_VIX_APPEND,
  SECTOR_ROTATION_CARD_TIP,
  UPCOMING_CATALYSTS_CARD_TIP,
  VIX_PULSE_NUMBER_TIP
} from "@/lib/ui-tooltips";
import type { SectorRotationChip } from "@/components/dashboard-redesign";
import type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";

export interface DashboardHeroStripProps {
  /** Regime label produced by the dashboard (Bullish / Bearish / Neutral / variants). */
  regimeLabel: string;
  /** True when VIX has live data and regime is fully informed (not breadth-only). */
  vixPulseOk: boolean;
  /** Indicates the regime is being calculated from price/breadth without VIX confirmation. */
  regimeBadgePriceBreadthOnly: boolean;
  /** Latest VIX snapshot (may be missing during market closed / data pending). */
  vixSnapshot?: SnapshotPayload;
  /** Session % change for VIX (positive = expanding fear, negative = compressing). */
  vixSessionPct: number | null;
  /** Sector rotation chips — five ETFs with 5d pct each. Source of breadth-dot row. */
  sectorRotation: SectorRotationChip[];
  /** Index rows — SPY / QQQ / IWM with pct5d. Feeds participation classification. */
  weeklyIndexRows: WeeklyIndexRow[];
  /** Upcoming earnings inside the next 7 sessions, sorted by report_date asc. */
  upcomingEarnings: EarningsEvent[];
  /** Soonest macro warning headline (if any) — drives Risk Horizon "Elevated" branch. */
  macroWarningHeadline?: string | null;
  /** VIX dash kind when blank — drives the "(market closed)" / "(data pending)" tag. */
  vixBlankTag?: string | null;
}

/**
 * Regime tone palette — the hero strip's regime pill uses a wider,
 * more confident colour treatment than the small role pills on the
 * master cards below. Bullish = green rail, Bearish = red rail,
 * Neutral / Mixed = caution amber rail. Unknown falls back to muted
 * slate so the strip never goes silent.
 */
function regimeTone(regimeLabel: string, colors: ThemeColors) {
  const r = regimeLabel.trim().toLowerCase();
  if (r.includes("bull")) {
    return {
      kind: "risk-on" as const,
      fg: colors.bullish,
      bg: "rgba(34,197,94,0.10)",
      border: "rgba(34,197,94,0.36)",
      rail: colors.bullish
    };
  }
  if (r.includes("bear")) {
    return {
      kind: "risk-off" as const,
      fg: colors.bearish,
      bg: "rgba(239,68,68,0.10)",
      border: "rgba(239,68,68,0.36)",
      rail: colors.bearish
    };
  }
  if (r.includes("neutral") || r.includes("mixed") || r.includes("range")) {
    return {
      kind: "mixed" as const,
      fg: colors.caution,
      bg: "rgba(245,158,11,0.10)",
      border: "rgba(245,158,11,0.36)",
      rail: colors.caution
    };
  }
  return {
    kind: "unknown" as const,
    fg: colors.textMuted,
    bg: "rgba(148,163,184,0.10)",
    border: "rgba(148,163,184,0.36)",
    rail: colors.textMuted
  };
}

/**
 * Short one-line context that follows the regime label inside the pill.
 * Strategy-agnostic — describes the read, does NOT prescribe action.
 */
function regimeOneLiner(regimeLabel: string, priceBreadthOnly: boolean): string {
  const r = regimeLabel.trim().toLowerCase();
  const base = r.includes("bull")
    ? "Index price + breadth lean upside"
    : r.includes("bear")
      ? "Index price + breadth lean downside"
      : r.includes("neutral") || r.includes("mixed") || r.includes("range")
        ? "Index price + breadth mixed"
        : "Regime input pending";
  return priceBreadthOnly ? `${base} (VIX unavailable)` : base;
}

/**
 * One coloured dot per sector ETF. Green if 5d > +0.2%, red if < -0.2%,
 * grey if flat or unknown. No symbol labels — they live downstream
 * inside the Swing Desk if at all, per the user directive that
 * shared context describes behaviour not leadership.
 */
function SectorBreadthDots({
  sectorRotation,
  colors
}: {
  sectorRotation: SectorRotationChip[];
  colors: ThemeColors;
}) {
  if (sectorRotation.length === 0) {
    return (
      <span
        data-testid="hero-strip-breadth-dots-empty"
        style={{ fontSize: typography.scale.xs, color: colors.textMuted }}
      >
        Breadth pending
      </span>
    );
  }
  return (
    <div
      className="flex items-center gap-1.5"
      data-testid="hero-strip-breadth-dots"
      aria-label="Sector breadth — one dot per tracked sector ETF, coloured by 5-day net change"
    >
      {sectorRotation.map((s) => {
        const pct = s.pct5d;
        const tone =
          typeof pct === "number" && Number.isFinite(pct)
            ? pct > 0.2
              ? colors.bullish
              : pct < -0.2
                ? colors.bearish
                : colors.textMuted
            : colors.textMuted;
        return (
          <span
            key={s.symbol}
            data-testid={`hero-strip-breadth-dot-${s.symbol}`}
            data-breadth-tone={
              typeof pct === "number" && Number.isFinite(pct)
                ? pct > 0.2
                  ? "up"
                  : pct < -0.2
                    ? "down"
                    : "flat"
                : "unknown"
            }
            title={`${s.symbol} ${s.label}: ${
              typeof pct === "number" ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"
            } (5d)`}
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: tone,
              opacity: 0.9,
              display: "inline-block",
              boxShadow: `0 0 0 1px color-mix(in srgb, ${tone} 25%, transparent)`
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Shared cell shell — every hero-strip cell uses this surface so the
 * eye reads them as a family. The cell carries a faint left-rail in
 * the cell's accent colour so the four cells feel related but each
 * tells a different story at a glance.
 */
function HeroCell({
  testId,
  label,
  rail,
  children,
  colors,
  minWidth = 220
}: {
  testId: string;
  label: string;
  rail: string;
  children: React.ReactNode;
  colors: ThemeColors;
  minWidth?: number;
}) {
  const style: CSSProperties = {
    flex: "1 1 0",
    minWidth,
    background: `linear-gradient(180deg, color-mix(in srgb, ${rail} 6%, ${colors.surfaceMuted}) 0%, ${colors.surfaceMuted} 100%)`,
    border: `1px solid color-mix(in srgb, ${colors.border} 88%, ${rail} 12%)`,
    borderLeft: `3px solid ${rail}`,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    display: "grid",
    gap: spacing[2],
    minHeight: 96
  };
  return (
    <article
      data-testid={testId}
      aria-label={label}
      className={surfaceGlowClassName}
      style={style}
    >
      <p
        style={{
          margin: 0,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          fontWeight: 600,
          color: colors.textMuted
        }}
      >
        {label}
      </p>
      {children}
    </article>
  );
}

export function DashboardHeroStrip({
  regimeLabel,
  vixPulseOk,
  regimeBadgePriceBreadthOnly,
  vixSnapshot,
  vixSessionPct,
  sectorRotation,
  weeklyIndexRows,
  upcomingEarnings,
  macroWarningHeadline,
  vixBlankTag
}: DashboardHeroStripProps) {
  const { colors } = useTheme();

  const tone = useMemo(() => regimeTone(regimeLabel, colors), [regimeLabel, colors]);
  const regimeContext = useMemo(
    () => regimeOneLiner(regimeLabel, regimeBadgePriceBreadthOnly),
    [regimeLabel, regimeBadgePriceBreadthOnly]
  );

  const vixLast = vixSnapshotDisplayLevel(vixSnapshot);
  const volatility: VolatilityCategory = useMemo(
    () => classifyVolatility(vixLast, vixSessionPct),
    [vixLast, vixSessionPct]
  );
  const vixSparkSource = useMemo(() => {
    const candidate = (vixSnapshot as { sparkline?: unknown } | undefined)?.sparkline;
    if (!Array.isArray(candidate)) return null;
    const clean = (candidate as unknown[])
      .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
      .filter((v): v is number => v != null);
    return clean.length >= 2 ? clean : null;
  }, [vixSnapshot]);

  const participation: ParticipationCategory = useMemo(
    () =>
      classifyParticipation(
        sectorRotation.map((s) => s.pct5d ?? null),
        weeklyIndexRows.map((r) => r.pct5d ?? null)
      ),
    [sectorRotation, weeklyIndexRows]
  );

  const sortedEarnings = useMemo(
    () =>
      [...upcomingEarnings].sort((a, b) =>
        String(a.report_date).localeCompare(String(b.report_date))
      ),
    [upcomingEarnings]
  );
  const risk: RiskHorizonCategory = useMemo(
    () => classifyRiskHorizon(sortedEarnings, macroWarningHeadline ?? null),
    [sortedEarnings, macroWarningHeadline]
  );
  const soonest = sortedEarnings[0];
  const soonestDateLabel = useMemo(() => {
    if (!soonest) return undefined;
    try {
      const [, mm, dd] = soonest.report_date.split("-");
      return mm && dd ? `${mm}/${dd}` : undefined;
    } catch {
      return undefined;
    }
  }, [soonest]);
  const riskLine = useMemo(
    () =>
      riskHorizonPlainLine(
        risk,
        sortedEarnings.length,
        macroWarningHeadline ?? null,
        soonest?.symbol,
        soonestDateLabel
      ),
    [risk, sortedEarnings.length, macroWarningHeadline, soonest?.symbol, soonestDateLabel]
  );

  const regimeBadgeExplanation = vixPulseOk
    ? REGIME_BADGE_TIP
    : `${REGIME_BADGE_TIP}${REGIME_WITHOUT_VIX_APPEND}`;

  return (
    <section
      className="dashboard-hero-strip"
      data-testid="dashboard-hero-strip"
      aria-label="Market at a glance"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: spacing[3]
      }}
    >
      {/* ── Cell 1: Regime pill ───────────────────────────────────── */}
      <HeroCell
        testId="hero-strip-regime"
        label="Regime"
        rail={tone.rail}
        colors={colors}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="hero-strip-regime-pill"
            data-regime-kind={tone.kind}
            style={{
              fontSize: typography.scale.base,
              fontWeight: 700,
              color: tone.fg,
              padding: "4px 12px",
              borderRadius: borderRadius.full,
              background: tone.bg,
              border: `1px solid ${tone.border}`,
              letterSpacing: "0.04em",
              textTransform: "capitalize"
            }}
          >
            {regimeLabel}
          </span>
          <InfoTip text={regimeBadgeExplanation} label="What this regime means" maxWidth={320} />
          <DashboardRealtime />
        </div>
        <p
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.5
          }}
        >
          {regimeContext}
        </p>
      </HeroCell>

      {/* ── Cell 2: VIX pulse ─────────────────────────────────────── */}
      <HeroCell
        testId="hero-strip-vix"
        label="Volatility (VIX)"
        rail={
          volatility === "Expanding"
            ? colors.caution
            : volatility === "Compressed"
              ? colors.bullish
              : colors.textMuted
        }
        colors={colors}
      >
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            data-testid="hero-strip-vix-level"
            style={{
              fontSize: typography.scale.lg,
              fontWeight: 700,
              color: colors.text,
              fontVariantNumeric: "tabular-nums"
            }}
          >
            {vixLast != null ? vixLast.toFixed(2) : "—"}
          </span>
          {vixSessionPct != null ? (
            <span
              style={{
                fontSize: typography.scale.sm,
                fontWeight: 600,
                color:
                  vixSessionPct > 0
                    ? colors.bearish // rising VIX = risk pressure rising
                    : vixSessionPct < 0
                      ? colors.bullish
                      : colors.textMuted,
                fontVariantNumeric: "tabular-nums"
              }}
            >
              {`${vixSessionPct >= 0 ? "+" : ""}${vixSessionPct.toFixed(2)}%`}
            </span>
          ) : vixBlankTag ? (
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, fontWeight: 600 }}>
              {vixBlankTag}
            </span>
          ) : null}
          <InfoTip text={VIX_PULSE_NUMBER_TIP} label="What VIX measures" maxWidth={300} />
        </div>
        <div className="flex items-center gap-2">
          {vixSparkSource ? (
            <IndexSparkline closes={vixSparkSource} width={72} height={18} ariaLabel="VIX intraday trajectory" />
          ) : null}
          <span
            data-testid="hero-strip-volatility-category"
            style={{
              fontSize: typography.scale.xs,
              color: colors.textMuted,
              lineHeight: 1.5
            }}
          >
            {volatility !== "Unknown" ? `${volatility} · ${volatilityPlainLine(volatility)}` : volatilityPlainLine(volatility)}
          </span>
        </div>
      </HeroCell>

      {/* ── Cell 3: Breadth dots + participation ──────────────────── */}
      <HeroCell
        testId="hero-strip-breadth"
        label="Sector breadth"
        rail={
          participation === "Broad"
            ? colors.bullish
            : participation === "Narrow"
              ? colors.bearish
              : colors.textMuted
        }
        colors={colors}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="hero-strip-participation-category"
            style={{
              fontSize: typography.scale.base,
              fontWeight: 700,
              color: colors.text
            }}
          >
            {participation}
          </span>
          <SectorBreadthDots sectorRotation={sectorRotation} colors={colors} />
          <InfoTip
            text={`${SECTOR_ROTATION_CARD_TIP}\n\nDots reflect 5-session ETF behaviour — descriptive only, no rankings.`}
            label="What sector breadth means"
            maxWidth={320}
          />
        </div>
        <p
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.5
          }}
        >
          {participationPlainLine(participation)}
        </p>
      </HeroCell>

      {/* ── Cell 4: Risk horizon ──────────────────────────────────── */}
      <HeroCell
        testId="hero-strip-risk-horizon"
        label="Risk horizon"
        rail={
          risk === "Elevated"
            ? colors.bearish
            : risk === "Active"
              ? colors.caution
              : colors.textMuted
        }
        colors={colors}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="hero-strip-risk-category"
            style={{
              fontSize: typography.scale.base,
              fontWeight: 700,
              color: colors.text
            }}
          >
            {risk}
          </span>
          <InfoTip text={UPCOMING_CATALYSTS_CARD_TIP} label="What risk horizon means" maxWidth={320} />
        </div>
        <p
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.5
          }}
        >
          {riskLine}
        </p>
        {soonest && soonestDateLabel ? (
          <p
            style={{
              margin: 0,
              fontSize: typography.scale.xs,
              color: colors.text,
              fontWeight: 500
            }}
          >
            <strong>{soonest.symbol}</strong> · {earningsTimingLabel(soonest.report_time)} · {soonestDateLabel}
          </p>
        ) : null}
      </HeroCell>
    </section>
  );
}
