"use client";

import { useMemo } from "react";
import Link from "next/link";
import { DashboardCard } from "@/components/dashboard-card";
import { IndexSparkline } from "@/components/index-sparkline";
import { InfoTip } from "@/components/info-tip";
import { DecisionMetric } from "@/components/decision-metric";
import { getChangeColor } from "@/components/market-sentiment-score-widget";
import {
  SHORT_HORIZON_TIMEFRAME_LINE,
  SHORT_HORIZON_WHY_THIS_MATTERS,
  type WeeklyIndexRow
} from "@/components/weekly-market-context-widget";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { MarketStatusPayload, SnapshotPayload } from "@/lib/api/market";
import type { EarningsEvent } from "@/lib/api/earnings";
import { earningsTimingLabel } from "@/lib/earnings-timing";
import type { SectorRotationChip } from "@/components/dashboard-redesign";
import {
  WEEKLY_MARKET_CONTEXT_CARD_TIP,
  SECTOR_ROTATION_CARD_TIP,
  UPCOMING_CATALYSTS_CARD_TIP,
  VIX_PULSE_NUMBER_TIP
} from "@/lib/ui-tooltips";

/**
 * SHARED CONTEXT · ALL TIMEFRAMES — the single master card that owns ALL
 * environmental context the two decision desks (Swing + Day) read from
 * (Mode Separation B28 Phase 2b).
 *
 * Replaces the previous four separate dashboard cards (Short-Horizon Market
 * State / Market pulse / Sector rotation / Upcoming earnings) with ONE
 * master card containing five strictly-ordered sub-sections:
 *
 *   A. RECENT SESSION MARKET STATE (Last ~5 Sessions)
 *      Three index sub-cards (SPY / QQQ / IWM): name, inline neutral
 *      sparkline (5 daily closes), and net % change. Path-and-smoothness
 *      readout for both day traders (chop vs trend expectations) and swing
 *      traders (progress vs congestion).
 *
 *   B. VOLATILITY ENVIRONMENT
 *      Category-only readout ("Contained / Expanding / Compressed") derived
 *      from VIX session change %. NO ATR numbers, NO directional bias —
 *      volatility describes range, not direction.
 *
 *   C. PARTICIPATION / BREADTH TONE
 *      Category-only readout ("Broad / Mixed / Narrow") derived from sector
 *      rotation chips. Counts ETFs positive vs negative on the same 5-day
 *      daily-close window as Section A.
 *
 *   D. RISK / EVENT HORIZON
 *      Time-based, NOT directional. Surfaces upcoming earnings count and
 *      the soonest tracked report. Macro warnings would slot in here when
 *      the macro pulse exposes them.
 *
 *   E. ENVIRONMENT SUMMARY (anchor line)
 *      Single human-readable sentence joining A + B + C + D. This is the
 *      sentence both desks "read first" before they decide whether to
 *      trade — strategy-agnostic by construction.
 *
 * NON-NEGOTIABLE: no sub-section text uses evaluative or strategy-coded
 * vocabulary ("setup", "continuation", "trend intact", "constructive").
 * Banned words have been audited under tests/dashboard-shared-context-
 * sections.test.tsx — adding strategy language here will fail the suite.
 */

type Props = {
  weeklyIndexRows: WeeklyIndexRow[];
  marketStatus?: MarketStatusPayload;
  vixSnapshot?: SnapshotPayload;
  vixSessionPct: number | null;
  sectorRotation: SectorRotationChip[];
  upcomingEarnings: EarningsEvent[];
  macroWarningHeadline?: string | null;
  /** Surfaced when the daily-bar / snapshot feed timed out — A-section falls back to a hint. */
  dataIssue?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Derivations (pure helpers — exported for direct test coverage)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Volatility category from VIX session change % + last-trade level.
 *
 *   - VIX level ≥ 22 OR VIX % >= +5 → "Expanding"
 *   - VIX level <= 13 OR VIX % <= -5 → "Compressed"
 *   - otherwise                      → "Contained"
 *   - missing data                   → "Unknown"
 *
 * Thresholds are intentionally conservative — VIX swings ±5% intraday on
 * any non-quiet day, and we don't want to flap the category. The numbers
 * are not surfaced; only the CATEGORY is shown per the user's directive.
 */
export type VolatilityCategory = "Contained" | "Expanding" | "Compressed" | "Unknown";

export function classifyVolatility(
  vixLevel: number | null | undefined,
  vixPct: number | null | undefined
): VolatilityCategory {
  const level = typeof vixLevel === "number" && Number.isFinite(vixLevel) ? vixLevel : null;
  const pct = typeof vixPct === "number" && Number.isFinite(vixPct) ? vixPct : null;
  if (level == null && pct == null) return "Unknown";
  if ((level != null && level >= 22) || (pct != null && pct >= 5)) return "Expanding";
  if ((level != null && level <= 13) || (pct != null && pct <= -5)) return "Compressed";
  return "Contained";
}

export function volatilityPlainLine(cat: VolatilityCategory): string {
  switch (cat) {
    case "Expanding":
      return "Daily ranges widening vs prior sessions";
    case "Compressed":
      return "Daily ranges compressing vs prior sessions";
    case "Contained":
      return "Daily ranges stable vs prior sessions";
    default:
      return "Volatility input pending";
  }
}

/**
 * Participation / breadth category from sector rotation chips + index breadth.
 *
 *   - ≥ 4 of 5 ETFs positive AND ≥ 2 of 3 indices positive on 5d → "Broad"
 *   - ≤ 1 of 5 ETFs positive AND ≤ 1 of 3 indices positive on 5d → "Narrow"
 *   - otherwise                                                  → "Mixed"
 *   - missing input                                              → "Unknown"
 *
 * "Broad" requires confirmation across BOTH the sector layer and the index
 * layer — a single benchmark surge with thin sector follow-through is the
 * canonical "narrow leadership" trap and must not classify as Broad.
 */
export type ParticipationCategory = "Broad" | "Mixed" | "Narrow" | "Unknown";

export function classifyParticipation(
  sectorPct5d: Array<number | null>,
  indexPct5d: Array<number | null>
): ParticipationCategory {
  const sectorClean = sectorPct5d.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const indexClean = indexPct5d.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (sectorClean.length === 0 && indexClean.length === 0) return "Unknown";
  const sectorUp = sectorClean.filter((v) => v > 0).length;
  const indexUp = indexClean.filter((v) => v > 0).length;
  if (sectorClean.length >= 4 && sectorUp >= 4 && indexClean.length >= 2 && indexUp >= 2) return "Broad";
  if (sectorClean.length >= 4 && sectorUp <= 1 && indexClean.length >= 2 && indexUp <= 1) return "Narrow";
  return "Mixed";
}

export function participationPlainLine(cat: ParticipationCategory): string {
  switch (cat) {
    case "Broad":
      return "Large- and small-cap indices and most sectors participating";
    case "Narrow":
      return "Few sectors or indices participating — leadership thin";
    case "Mixed":
      return "Mixed participation across sectors and indices";
    default:
      return "Participation input pending";
  }
}

/**
 * Risk-horizon category from upcoming earnings + macro warnings.
 *
 *   - macroWarning present                            → "Elevated"
 *   - ≥ 4 tracked earnings in the next 7 days         → "Active"
 *   - 1-3 tracked earnings                            → "Quiet"
 *   - 0 tracked earnings AND no macro warning         → "Quiet"
 *
 * Time-based, NOT directional. The user's directive: "Risk Horizon: Elevated.
 * High-impact Fed event in 7 days." — the line tells you WHEN the next
 * potential disruption is, not whether to trade through it.
 */
export type RiskHorizonCategory = "Elevated" | "Active" | "Quiet" | "Unknown";

export function classifyRiskHorizon(
  upcomingEarnings: EarningsEvent[],
  macroWarning: string | null | undefined
): RiskHorizonCategory {
  if (typeof macroWarning === "string" && macroWarning.trim().length > 0) return "Elevated";
  const count = upcomingEarnings.length;
  if (count >= 4) return "Active";
  if (count > 0) return "Quiet";
  return "Quiet";
}

export function riskHorizonPlainLine(
  cat: RiskHorizonCategory,
  upcomingCount: number,
  macroWarning: string | null | undefined,
  soonestSymbol?: string,
  soonestDateLabel?: string
): string {
  if (cat === "Elevated" && macroWarning) return macroWarning;
  if (cat === "Active") {
    return soonestSymbol && soonestDateLabel
      ? `${upcomingCount} tracked earnings this week · next: ${soonestSymbol} on ${soonestDateLabel}`
      : `${upcomingCount} tracked earnings this week`;
  }
  if (cat === "Quiet" && upcomingCount > 0) {
    return soonestSymbol && soonestDateLabel
      ? `${upcomingCount} tracked earnings · next: ${soonestSymbol} on ${soonestDateLabel}`
      : `${upcomingCount} tracked earnings this week`;
  }
  return "No tracked earnings or high-impact macro prints in the next 7 sessions";
}

/**
 * Environment summary — single descriptive sentence combining A + B + C + D.
 *
 * Per the user's directive: "Short-horizon price drift up, volatility contained,
 * participation broad, macro risk approaching." Strategy-agnostic — describes
 * what the environment IS, not what to do about it.
 */
export function buildEnvironmentSummary(
  weeklyAvgPct5d: number | null,
  volatility: VolatilityCategory,
  participation: ParticipationCategory,
  risk: RiskHorizonCategory
): string {
  let drift: string;
  if (weeklyAvgPct5d == null) drift = "Short-horizon price drift unknown";
  else if (weeklyAvgPct5d >= 0.6) drift = "Short-horizon price drift up";
  else if (weeklyAvgPct5d <= -0.6) drift = "Short-horizon price drift down";
  else drift = "Short-horizon price drift mixed";

  const volPhrase = volatility === "Unknown" ? "volatility pending" : `volatility ${volatility.toLowerCase()}`;
  const partPhrase =
    participation === "Unknown" ? "participation pending" : `participation ${participation.toLowerCase()}`;
  const riskPhrase =
    risk === "Elevated" ? "macro risk approaching" : risk === "Active" ? "earnings risk approaching" : "macro risk quiet";

  return `${drift}, ${volPhrase}, ${partPhrase}, ${riskPhrase}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visual primitives
// ─────────────────────────────────────────────────────────────────────────────

function SubsectionHeader({
  letter,
  label,
  cardTip,
  colors,
  testid
}: {
  letter: string;
  label: string;
  cardTip?: string;
  colors: ThemeColors;
  testid?: string;
}) {
  return (
    <header
      data-testid={testid}
      style={{
        display: "flex",
        alignItems: "center",
        gap: spacing[2],
        margin: 0
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: borderRadius.full,
          background: `color-mix(in srgb, ${colors.textMuted} 18%, transparent)`,
          color: colors.text,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0
        }}
      >
        {letter}
      </span>
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          fontWeight: 700,
          color: colors.text
        }}
      >
        {label}
      </span>
      {cardTip ? <InfoTip text={cardTip} label={`About ${label}`} maxWidth={320} /> : null}
    </header>
  );
}

function SubsectionDivider({ colors }: { colors: ThemeColors }) {
  return (
    <hr
      style={{
        border: "none",
        borderTop: `1px dashed color-mix(in srgb, ${colors.border} 70%, transparent)`,
        margin: 0
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Master card
// ─────────────────────────────────────────────────────────────────────────────

export function SharedContextMasterCard(props: Props) {
  const {
    weeklyIndexRows,
    marketStatus,
    vixSnapshot,
    vixSessionPct,
    sectorRotation,
    upcomingEarnings,
    macroWarningHeadline,
    dataIssue
  } = props;
  const { colors } = useTheme();
  const mkt = (marketStatus?.market || "").toLowerCase();

  const weeklyAvgPct5d = useMemo(() => {
    const vals = weeklyIndexRows
      .map((r) => r.pct5d)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [weeklyIndexRows]);

  const vixLevel =
    vixSnapshot && typeof vixSnapshot.last_trade_price === "number" && Number.isFinite(vixSnapshot.last_trade_price)
      ? vixSnapshot.last_trade_price
      : null;
  const volatility = useMemo(() => classifyVolatility(vixLevel, vixSessionPct), [vixLevel, vixSessionPct]);
  const participation = useMemo(
    () =>
      classifyParticipation(
        sectorRotation.map((s) => s.pct5d),
        weeklyIndexRows.map((r) => r.pct5d)
      ),
    [sectorRotation, weeklyIndexRows]
  );
  const sortedEarnings = useMemo(
    () => [...upcomingEarnings].sort((a, b) => a.report_date.localeCompare(b.report_date)),
    [upcomingEarnings]
  );
  const risk = useMemo(
    () => classifyRiskHorizon(sortedEarnings, macroWarningHeadline ?? null),
    [sortedEarnings, macroWarningHeadline]
  );
  const soonest = sortedEarnings[0];
  const soonestDateLabel = soonest
    ? `${earningsTimingLabel(soonest.report_time)} · ${soonest.report_date.slice(5).replace("-", "/")}`
    : undefined;
  const environmentSummary = useMemo(
    () => buildEnvironmentSummary(weeklyAvgPct5d, volatility, participation, risk),
    [weeklyAvgPct5d, volatility, participation, risk]
  );

  return (
    <DashboardCard
      role="shared"
      eyebrow="All timeframes · used by both desks"
      title="Shared Context"
      subtitle="Market environment and constraints used by all desks. Not a trade signal."
      cardTip={WEEKLY_MARKET_CONTEXT_CARD_TIP}
      data-testid="shared-context-master-card"
      headerRight={
        marketStatus ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, alignSelf: "center" }}>
            Cash session:{" "}
            <strong style={{ color: mkt === "open" ? colors.bullish : colors.textMuted }}>
              {mkt === "open" ? "Open" : "Closed"}
            </strong>
          </span>
        ) : null
      }
    >
      <div style={{ display: "grid", gap: spacing[5] }}>
        {/* ───────────────────────────── Section A ───────────────────────────── */}
        <section
          data-testid="shared-context-section-A"
          style={{ display: "grid", gap: spacing[3] }}
        >
          <SubsectionHeader
            letter="A"
            label="Recent Session Market State (Last ~5 Sessions)"
            cardTip="Inline 5-day daily-close sparklines + net % change for SPY, QQQ, IWM. Shared backdrop both desks read; descriptive, not a setup signal."
            colors={colors}
          />
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
            data-testid="shared-context-index-grid"
          >
            {weeklyIndexRows.map((r) => {
              const hasCloses = Array.isArray(r.closes5d) && r.closes5d.length >= 2;
              return (
                <div
                  key={r.symbol}
                  data-testid={`shared-context-index-tile-${r.symbol}`}
                  style={{
                    borderRadius: borderRadius.md,
                    border: `1px solid ${colors.border}`,
                    background: "rgba(148,163,184,0.06)",
                    padding: spacing[3],
                    display: "grid",
                    gap: spacing[2]
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: typography.scale.sm, color: colors.text }}>
                      {r.symbol}
                    </p>
                    <p style={{ margin: 0, fontSize: 10, color: colors.textMuted }}>{r.label}</p>
                  </div>
                  {hasCloses ? (
                    <IndexSparkline closes={r.closes5d!} ariaLabel={`${r.symbol} 5-session close trajectory`} />
                  ) : (
                    <span style={{ fontSize: 10, color: colors.textMuted }}>Sparkline pending</span>
                  )}
                  <div
                    style={{
                      fontSize: typography.scale.base,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: r.pct5d != null ? getChangeColor(r.pct5d, colors) : colors.textMuted
                    }}
                  >
                    {r.pct5d != null ? (
                      <DecisionMetric
                        explanation="Change from the daily close roughly five sessions ago to the latest daily close for this index. Uses calendar trading days returned by Polygon — descriptive of recent price behavior across all desks, not a swing-only signal."
                        label="How 5-session % is computed"
                        maxWidth={300}
                      >
                        <span>{`${r.pct5d >= 0 ? "+" : ""}${r.pct5d.toFixed(2)}%`}</span>
                      </DecisionMetric>
                    ) : (
                      "—"
                    )}
                  </div>
                  {r.lastPrice != null ? (
                    <div
                      style={{
                        fontSize: typography.scale.xs,
                        color: colors.textMuted,
                        fontVariantNumeric: "tabular-nums"
                      }}
                    >
                      Last <span style={{ color: colors.text }}>${r.lastPrice.toFixed(2)}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {dataIssue ? (
            <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.caution, lineHeight: 1.5 }}>
              {dataIssue}
            </p>
          ) : null}
        </section>

        <SubsectionDivider colors={colors} />

        {/* ───────────────────────────── Section B ───────────────────────────── */}
        <section
          data-testid="shared-context-section-B"
          style={{ display: "grid", gap: spacing[2] }}
        >
          <SubsectionHeader
            letter="B"
            label="Volatility Environment"
            cardTip={`${VIX_PULSE_NUMBER_TIP}\n\nThis section reports volatility CATEGORY only — no ATR numbers — derived from the VIX session change and level.`}
            colors={colors}
          />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              data-testid="shared-context-volatility-category"
              style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text }}
            >
              Volatility: {volatility}
            </span>
            <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
              {volatilityPlainLine(volatility)}
            </span>
          </div>
        </section>

        <SubsectionDivider colors={colors} />

        {/* ───────────────────────────── Section C ───────────────────────────── */}
        <section
          data-testid="shared-context-section-C"
          style={{ display: "grid", gap: spacing[2] }}
        >
          <SubsectionHeader
            letter="C"
            label="Participation / Breadth Tone"
            cardTip={SECTOR_ROTATION_CARD_TIP}
            colors={colors}
          />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              data-testid="shared-context-participation-category"
              style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text }}
            >
              Participation: {participation}
            </span>
            <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
              {participationPlainLine(participation)}
            </span>
          </div>
          {sectorRotation.length > 0 ? (
            <div
              className="flex flex-wrap gap-x-3 gap-y-1"
              style={{
                fontSize: typography.scale.xs,
                fontVariantNumeric: "tabular-nums",
                marginTop: spacing[1]
              }}
              data-testid="shared-context-sector-chip-row"
            >
              {sectorRotation.map((s) => (
                <span key={s.symbol} style={{ color: colors.text }}>
                  <strong style={{ fontWeight: 600 }}>{s.symbol}</strong>{" "}
                  <span style={{ color: s.pct5d != null ? getChangeColor(s.pct5d, colors) : colors.textMuted }}>
                    {s.pct5d != null ? `${s.pct5d >= 0 ? "+" : ""}${s.pct5d.toFixed(1)}%` : "—"}
                  </span>
                  <span style={{ color: colors.textMuted, fontWeight: 400 }}> · {s.label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <SubsectionDivider colors={colors} />

        {/* ───────────────────────────── Section D ───────────────────────────── */}
        <section
          data-testid="shared-context-section-D"
          style={{ display: "grid", gap: spacing[2] }}
        >
          <SubsectionHeader
            letter="D"
            label="Risk / Event Horizon"
            cardTip={UPCOMING_CATALYSTS_CARD_TIP}
            colors={colors}
          />
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              data-testid="shared-context-risk-category"
              style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text }}
            >
              Risk Horizon: {risk}
            </span>
            <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
              {riskHorizonPlainLine(risk, sortedEarnings.length, macroWarningHeadline ?? null, soonest?.symbol, soonestDateLabel)}
            </span>
          </div>
          {sortedEarnings.length > 0 ? (
            <ul
              style={{
                margin: 0,
                paddingLeft: spacing[4],
                color: colors.text,
                fontSize: typography.scale.xs,
                lineHeight: 1.5
              }}
              data-testid="shared-context-earnings-list"
            >
              {sortedEarnings.slice(0, 5).map((e) => (
                <li key={`${e.symbol}-${e.report_date}`}>
                  <strong>{e.symbol}</strong> · {earningsTimingLabel(e.report_time)} ·{" "}
                  {e.report_date.slice(5).replace("-", "/")}
                  {e.company_name ? <span style={{ color: colors.textMuted }}> — {e.company_name}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <SubsectionDivider colors={colors} />

        {/* ───────────────────────────── Section E ───────────────────────────── */}
        <section
          data-testid="shared-context-section-E"
          style={{ display: "grid", gap: spacing[2] }}
        >
          <SubsectionHeader letter="E" label="Environment Summary" colors={colors} />
          <p
            data-testid="shared-context-environment-summary"
            style={{
              margin: 0,
              fontSize: typography.scale.base,
              fontWeight: 600,
              color: colors.text,
              lineHeight: 1.5
            }}
          >
            {environmentSummary}
          </p>
          <div
            data-testid="shared-context-guardrails"
            style={{
              display: "grid",
              gap: spacing[1],
              marginTop: spacing[1],
              fontSize: typography.scale.xs,
              color: colors.textMuted,
              lineHeight: 1.5
            }}
          >
            <p style={{ margin: 0 }}>{SHORT_HORIZON_TIMEFRAME_LINE}</p>
            <p style={{ margin: 0 }}>{SHORT_HORIZON_WHY_THIS_MATTERS}</p>
          </div>
        </section>
      </div>
    </DashboardCard>
  );
}

/** Small tertiary surface — Signal Validation Ledger lives below the three master
 *  cards now. Tracked outcomes are not "market context", so they cannot live
 *  inside the Shared Context master card; they are also not a decision engine,
 *  so they cannot be a peer master card. This component renders a low-prominence
 *  link surface — explicitly NOT role-colored, no rail-line border — so it does
 *  not compete with the three master cards above. Exported from the same module
 *  to keep the "Shared Context family" cohesively co-located. */
export function SignalValidationLedgerTertiarySurface() {
  const { colors } = useTheme();
  return (
    <aside
      data-testid="signal-validation-ledger-tertiary"
      style={{
        borderTop: `1px solid color-mix(in srgb, ${colors.border} 60%, transparent)`,
        paddingTop: spacing[4],
        display: "grid",
        gap: spacing[2]
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p
          style={{
            margin: 0,
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 700,
            color: colors.textMuted
          }}
        >
          Validation · tracked outcomes
        </p>
        <Link
          href="/dashboard/signal-validation"
          style={{ fontSize: typography.scale.sm, color: colors.accent, fontWeight: 600 }}
        >
          Open ledger (Swing / Day) →
        </Link>
      </div>
      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        Tracked outcomes — not a brokerage account. The ledger itself is mode-segmented inside the Signal Validation
        page; this dashboard surface is just a link.
      </p>
    </aside>
  );
}
