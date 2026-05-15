"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { DashboardCard } from "@/components/dashboard-card";
import { IndexReturnsHistogram } from "@/components/index-returns-histogram";
import { IndexSessionRangeBar } from "@/components/index-session-range-bar";
import { InfoTip } from "@/components/info-tip";
import { DecisionMetric } from "@/components/decision-metric";
import { getChangeColor } from "@/components/market-sentiment-score-widget";
import {
  SHORT_HORIZON_TIMEFRAME_LINE,
  SHORT_HORIZON_WHY_THIS_MATTERS,
  type WeeklyIndexRow
} from "@/components/weekly-market-context-widget";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, cardSurfaceStyle, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { MarketStatusPayload, SnapshotPayload } from "@/lib/api/market";
import type { EarningsEvent } from "@/lib/api/earnings";
import { earningsTimingLabel } from "@/lib/earnings-timing";
import type { SectorRotationChip } from "@/components/dashboard-redesign";
import {
  WEEKLY_MARKET_CONTEXT_CARD_TIP,
  SHARED_CONTEXT_HISTOGRAM_TIP,
  SHARED_CONTEXT_INTRADAY_GAUGE_TIP,
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
 *      Three index sub-cards (SPY / QQQ / IWM): name, horizontal per-session
 *      return bars (5 daily closes), optional cash-session range track, and
 *      net % change. Path readout for both day traders and swing traders.
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
  /**
   * `master` — standalone Shared Context card (dual-desk dashboard).
   * `embedded` — same A–E ladder nested under the Swing Desk (Swing Pro / no day surfaces).
   */
  layout?: "master" | "embedded";
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
 * Rotation profile — behavioral classification of how capital is moving across
 * sectors. STRICTLY DESCRIPTIVE of "how the market feels", never ranked.
 *
 * Per the user directive: shared context for sector activity must answer the
 * question "what kind of market environment are all traders operating in?" —
 * NOT "which sector leads next?" or "where to allocate?". Names, rankings,
 * and "leadership emerging" language are banned (they belong inside the Swing
 * Desk downstream). This helper returns only the BEHAVIORAL pattern:
 *
 *   - "Concentrated" — high dispersion + narrow positives (1-2 sectors
 *     dragging the index while the rest are quiet/negative). Day traders
 *     should expect chop, swing traders should expect fragile follow-through.
 *   - "Rotational"   — mixed direction across sectors + moderate dispersion.
 *     Capital is cycling, no single sector controls the move. Both groups
 *     should expect inconsistent follow-through and faster fades.
 *   - "Mixed"        — partial leadership pattern that doesn't cleanly fit
 *     either concentrated or rotational.
 *   - "Unknown"      — insufficient sector data.
 *
 * Notice the absence of "Trending", "Leading", or any allocation-flavored
 * label. That's intentional.
 */
export type RotationProfileCategory = "Concentrated" | "Rotational" | "Mixed" | "Unknown";

export function classifyRotationProfile(sectorPct5d: Array<number | null>): RotationProfileCategory {
  const clean = sectorPct5d.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (clean.length < 3) return "Unknown";
  const sorted = [...clean].sort((a, b) => b - a);
  const max = sorted[0]!;
  const min = sorted[sorted.length - 1]!;
  const spread = max - min;
  const positives = clean.filter((v) => v > 0.2).length;
  const negatives = clean.filter((v) => v < -0.2).length;
  // Concentrated: a few outliers pull the average — high spread but only 1-2
  // sectors are meaningfully positive. The "narrow leadership" pattern.
  if (spread >= 3 && positives >= 1 && positives <= 2) return "Concentrated";
  // Rotational: capital splits across sectors in BOTH directions with
  // meaningful spread — no single sector controls the move.
  if (positives >= 2 && negatives >= 1 && spread >= 1.5) return "Rotational";
  return "Mixed";
}

/**
 * Plain-language line for rotation profile — strictly DESCRIPTIVE of capital
 * flow, never directional or actionable. No sector NAMES, no "leadership
 * emerging", no allocation language.
 */
export function rotationProfilePlainLine(cat: RotationProfileCategory): string {
  switch (cat) {
    case "Concentrated":
      return "Narrow leadership — a few sectors carrying the move; broad follow-through unlikely";
    case "Rotational":
      return "Capital rotating across sectors — no single sector controlling the move; expect inconsistent follow-through";
    case "Mixed":
      return "Mixed sector behavior — partial leadership, no dominant pattern";
    default:
      return "Sector activity pending";
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

/**
 * Bordered sub-card wrapper for Sections B / C / D / E.
 *
 * Phase 2c — the user's directive was explicit: "under shared context B, C, D
 * E sections should be cards with highlighted border like other cards". A
 * sub-card treatment makes each environmental signal read as a discrete unit
 * (Volatility / Participation / Risk / Summary) instead of a paragraph in a
 * single wall of text. The border picks up a soft slate-tinted accent so the
 * sub-cards stay coherent with the master card's shared-context identity
 * without competing with the master card's bright rail-line border.
 *
 * Section A is intentionally NOT wrapped — it is already a row of three
 * direction-bordered index tiles (SPY / QQQ / IWM), each of which IS the
 * sub-card. Wrapping Section A in a fourth card would create card-in-card-in
 * -card nesting that defeats the at-a-glance scan.
 */
function SubsectionCard({
  colors,
  testid,
  dataAttrs,
  children
}: {
  colors: ThemeColors;
  testid?: string;
  dataAttrs?: Record<string, string | undefined>;
  children: ReactNode;
}) {
  // Delegates to the canonical {@link cardSurfaceStyle} neutral shell so the
  // Shared Context sub-sections (B / C / D / E) share the same visual contract
  // as every other card in the app (Signals page, Scanner page, Evidence
  // sub-panels). Phase 2c's 1.5px slate-tinted border + gradient was retired
  // when the user asked for uniform look-and-feel across the application.
  const shell = cardSurfaceStyle(colors, "neutral");
  return (
    <div
      data-testid={testid}
      {...(dataAttrs ?? {})}
      style={{
        borderRadius: borderRadius.lg,
        border: shell.border,
        background: shell.background,
        boxShadow: shell.boxShadow,
        padding: spacing[3],
        display: "grid",
        gap: spacing[2]
      }}
    >
      {children}
    </div>
  );
}

/**
 * Direction-aware border helper for the SPY / QQQ / IWM tiles in Section A.
 *
 * Phase 2c — per user directive: "spy qqq and iwm should have highlighted
 * border like other cards in the app, like green when up and red when down".
 * This keeps the orthogonal channel discipline intact:
 *   - PRICE DIRECTION (green/red) — on numbers AND on the tile borders here.
 *     Both are reading the same signal: did 5-session price drift up or down.
 *   - DESK ROLE (slate/indigo/teal) — still owned by the MASTER card border.
 *
 * The two channels don't compete because they live on different surfaces:
 * the tile border lives INSIDE Section A, the role border lives on the
 * OUTSIDE of the master card. A glance reads "shared context (slate rail) →
 * 5-session state (green/red tiles) → up or down".
 *
 * Threshold: ±0.1% mirrors the legacy `getChangeColor` neutral-band on
 * the percent number — keeps the tile border and the % number in lockstep
 * so they never disagree visually.
 */
function indexTileBorderForDirection(
  pct5d: number | null | undefined,
  colors: ThemeColors
): string {
  if (typeof pct5d !== "number" || !Number.isFinite(pct5d)) {
    return `1.5px solid color-mix(in srgb, ${colors.border} 55%, ${colors.textMuted} 30%)`;
  }
  if (pct5d > 0.1) {
    return `1.5px solid color-mix(in srgb, ${colors.bullish} 70%, ${colors.border})`;
  }
  if (pct5d < -0.1) {
    return `1.5px solid color-mix(in srgb, ${colors.bearish} 70%, ${colors.border})`;
  }
  return `1.5px solid color-mix(in srgb, ${colors.border} 55%, ${colors.textMuted} 30%)`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Master card
// ─────────────────────────────────────────────────────────────────────────────

/**
 * localStorage key for the "Show / hide full breakdown" toggle on the
 * Shared Context master card. Phase A2 of the dashboard redesign.
 *
 * Default state is COLLAPSED: the Hero Strip above already answers the
 * "what's the market doing right now?" question at a glance, and most
 * users don't need the full A–E ladder on every page load. Power users
 * who do want the prose ladder open across sessions get their
 * preference persisted here — the chevron toggle writes "1" / "0" and
 * subsequent visits read it back during the post-mount effect.
 *
 * `1` = collapsed (default), `0` = expanded.
 */
const SHARED_CONTEXT_COLLAPSED_STORAGE_KEY = "stocvest_shared_context_collapsed";

export function SharedContextMasterCard(props: Props) {
  const {
    weeklyIndexRows,
    marketStatus,
    vixSnapshot,
    vixSessionPct,
    sectorRotation,
    upcomingEarnings,
    macroWarningHeadline,
    dataIssue,
    layout = "master"
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
  // Phase 2c — behavioral rotation profile (concentrated / rotational / mixed)
  // strictly derived from sector dispersion. No NAMES, no rankings, no leadership
  // language — Section C describes capital-flow PATTERN, not "what to buy".
  const rotationProfile = useMemo(
    () => classifyRotationProfile(sectorRotation.map((s) => s.pct5d)),
    [sectorRotation]
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

  /*
   * Phase A2 — collapsed-by-default UX. Default state matches the SSR
   * render (collapsed = true) to avoid hydration-mismatch flicker; the
   * post-mount effect reads localStorage and may flip to expanded if
   * the user previously chose to keep the full ladder open. The
   * `data-shared-context-collapsed` attribute on the card surface
   * gives integration tests and CSS a stable anchor to read state from.
   *
   * IMPORTANT: every sub-section (A–E) is ALWAYS mounted in the DOM
   * regardless of collapsed state — the regression-locking test
   * `master_card_renders_all_five_subsections_A_through_E_in_order`
   * uses `getByTestId` + `compareDocumentPosition`, both of which work
   * on hidden-via-CSS nodes. We hide B–E with `style={{ display: none }}`
   * when collapsed; Section A (index tiles + sparklines) is the only
   * one ALWAYS visually rendered because it's already at-a-glance value.
   */
  const [collapsed, setCollapsed] = useState(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SHARED_CONTEXT_COLLAPSED_STORAGE_KEY);
      if (raw === "0") setCollapsed(false);
      else if (raw === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SHARED_CONTEXT_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const sessionStatusStrip =
    marketStatus ? (
      <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, alignSelf: "center" }}>
        Cash session:{" "}
        <strong style={{ color: mkt === "open" ? colors.bullish : colors.textMuted }}>
          {mkt === "open" ? "Open" : "Closed"}
        </strong>
      </span>
    ) : null;

  const contextGrid = (
      <div style={{ display: "grid", gap: spacing[5] }}>
        {/* ───────────────────────────── Section A ───────────────────────────── */}
        <section
          data-testid="shared-context-section-A"
          style={{ display: "grid", gap: spacing[3] }}
        >
          <SubsectionHeader
            letter="A"
            label="Recent Session Market State (Last ~5 Sessions)"
            cardTip="Short-term **bias** from daily closes (5‑session net + per-day bars) vs **today’s behavior** (intraday position in the cash high–low). Shared backdrop for both desks — descriptive tape context only, not permission to trade."
            colors={colors}
          />
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
            data-testid="shared-context-index-grid"
          >
            {weeklyIndexRows.map((r) => {
              const hasCloses = Array.isArray(r.closes5d) && r.closes5d.length >= 2;
              return (
                <div
                  key={r.symbol}
                  data-testid={`shared-context-index-tile-${r.symbol}`}
                  data-tile-direction={
                    typeof r.pct5d === "number" && Number.isFinite(r.pct5d)
                      ? r.pct5d > 0.1
                        ? "up"
                        : r.pct5d < -0.1
                          ? "down"
                          : "flat"
                      : "unknown"
                  }
                  style={{
                    borderRadius: borderRadius.md,
                    // Direction-aware highlighted border: green when 5-session
                    // net % is up, red when down, neutral when flat/unknown.
                    // The role border (slate rail) lives on the MASTER card —
                    // these inner tiles only encode price direction.
                    border: indexTileBorderForDirection(r.pct5d, colors),
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
                    <div style={{ width: "100%", minWidth: 0, display: "grid", gap: spacing[1] }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: spacing[2]
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <p
                            style={{
                              margin: 0,
                              fontSize: 9,
                              color: colors.textMuted,
                              lineHeight: 1.35,
                              fontWeight: 600
                            }}
                          >
                            Daily returns (last ~5 sessions)
                          </p>
                          <p style={{ margin: "2px 0 0", fontSize: 8, color: colors.textMuted, lineHeight: 1.35 }}>
                            Oldest at top → newest at bottom
                          </p>
                        </div>
                        <InfoTip text={SHARED_CONTEXT_HISTOGRAM_TIP} label="About daily return bars" maxWidth={320} />
                      </div>
                      <IndexReturnsHistogram
                        closes={r.closes5d!}
                        ariaLabel={`${r.symbol} 5-session daily returns histogram`}
                      />
                    </div>
                  ) : (
                    <span style={{ fontSize: 10, color: colors.textMuted }}>Daily returns chart pending</span>
                  )}
                  {r.sessionDayRange ? (
                    <div style={{ width: "100%", minWidth: 0, display: "grid", gap: spacing[1] }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: spacing[2]
                        }}
                      >
                        <p
                          style={{
                            margin: 0,
                            fontSize: 9,
                            color: colors.textMuted,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            lineHeight: 1.3,
                            fontWeight: 600
                          }}
                        >
                          Intraday position (low → high)
                        </p>
                        <InfoTip text={SHARED_CONTEXT_INTRADAY_GAUGE_TIP} label="About intraday position" maxWidth={320} />
                      </div>
                      <p style={{ margin: 0, fontSize: 8, color: colors.textMuted, lineHeight: 1.35 }}>
                        Today&apos;s cash session — how price sits inside today&apos;s range (not the 5‑session net above)
                      </p>
                      <IndexSessionRangeBar
                        low={r.sessionDayRange.low}
                        high={r.sessionDayRange.high}
                        last={r.sessionDayRange.last}
                        open={r.sessionDayRange.open}
                        prevClose={r.sessionDayRange.prevClose}
                        colors={colors}
                      />
                    </div>
                  ) : null}
                  <div
                    style={{
                      fontSize: typography.scale.base,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: colors.text
                    }}
                  >
                    {r.pct5d != null ? (
                      <DecisionMetric
                        explanation="Change from the daily close roughly five sessions ago to the latest daily close for this index. Uses calendar trading days returned by Polygon — descriptive of recent price behavior across all desks, not a swing-only signal."
                        label="How 5-session net is computed"
                        maxWidth={300}
                      >
                        <span style={{ color: colors.textMuted, fontWeight: 600 }}>
                          5‑Session Net Return:{" "}
                        </span>
                        <span style={{ color: getChangeColor(r.pct5d, colors) }}>{`${r.pct5d >= 0 ? "+" : ""}${r.pct5d.toFixed(2)}%`}</span>
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

        {/*
         * Phase A2 — slim summary line shown when the full ladder is
         * collapsed. Uses the same `buildEnvironmentSummary` derivation
         * as Section E so the two surfaces stay in sync; this is just
         * a single-line projection of the same data.
         */}
        {collapsed ? (
          <div
            data-testid="shared-context-collapsed-summary"
            className={surfaceGlowClassName}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: spacing[2],
              padding: `${spacing[3]} ${spacing[3]}`,
              borderRadius: borderRadius.md,
              border: `1px dashed color-mix(in srgb, ${colors.border} 70%, transparent)`,
              background: "rgba(148,163,184,0.04)"
            }}
          >
            <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: colors.text, lineHeight: 1.5, flex: "1 1 240px" }}>
              {environmentSummary}
            </span>
            <button
              type="button"
              data-testid="shared-context-toggle"
              data-shared-context-collapsed="true"
              aria-expanded={false}
              onClick={toggleCollapsed}
              className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-semibold"
              style={{
                border: `1px solid ${colors.border}`,
                color: colors.text,
                background: colors.surfaceMuted
              }}
            >
              <ChevronDown size={14} aria-hidden />
              Show full breakdown
            </button>
          </div>
        ) : null}

        {/*
         * Sections B–E always mount in the DOM (regression-locking
         * tests require it), but visually hide with display:none when
         * collapsed. The wrapper preserves DOM order B → C → D → E.
         */}
        <div
          data-testid="shared-context-expanded-body"
          aria-hidden={collapsed}
          style={{ display: collapsed ? "none" : "grid", gap: spacing[5] }}
        >
        <SubsectionDivider colors={colors} />

        {/* ───────────────────────────── Section B ───────────────────────────── */}
        <SubsectionCard
          colors={colors}
          testid="shared-context-section-B"
          dataAttrs={{ "data-subsection-card": "B" }}
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
        </SubsectionCard>

        <SubsectionDivider colors={colors} />

        {/* ───────────────────────────── Section C ───────────────────────────── */}
        {/*
         * Section C (Phase 2c rewrite) — Sector behavior is shared context if and
         * only if it answers "what kind of market environment are all traders
         * operating in right now?" — NOT "which sector leads next?" or "where
         * should I allocate?". Per user directive: rotation here is presented
         * BEHAVIORALLY (Rotation profile + Participation categories) with NO
         * % rankings, NO sector chips, NO "winners". Any leadership/allocation
         * framing belongs DOWNSTREAM inside the Swing Desk, not here.
         */}
        <SubsectionCard
          colors={colors}
          testid="shared-context-section-C"
          dataAttrs={{ "data-subsection-card": "C" }}
        >
          <SubsectionHeader
            letter="C"
            label="Sector Participation (Last ~5 Sessions)"
            cardTip={`${SECTOR_ROTATION_CARD_TIP}\n\nReports BEHAVIOR only — capital-flow PATTERN across sectors over the last ~5 sessions. No rankings, no leadership names — those live downstream inside the Swing Desk if they exist at all.`}
            colors={colors}
          />
          {/* Categorical readout 1 — Rotation profile (the dominant capital-flow pattern) */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              data-testid="shared-context-rotation-profile-category"
              style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text }}
            >
              Rotation profile: {rotationProfile}
            </span>
            <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
              {rotationProfilePlainLine(rotationProfile)}
            </span>
          </div>
          {/* Categorical readout 2 — Participation (breadth quality, not opportunity) */}
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
        </SubsectionCard>

        <SubsectionDivider colors={colors} />

        {/* ───────────────────────────── Section D ───────────────────────────── */}
        <SubsectionCard
          colors={colors}
          testid="shared-context-section-D"
          dataAttrs={{ "data-subsection-card": "D" }}
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
        </SubsectionCard>

        <SubsectionDivider colors={colors} />

        {/* ───────────────────────────── Section E ───────────────────────────── */}
        <SubsectionCard
          colors={colors}
          testid="shared-context-section-E"
          dataAttrs={{ "data-subsection-card": "E" }}
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
            <p style={{ margin: 0, fontWeight: 600 }}>
              Shared Context is descriptive backdrop — not an entry trigger on its own. Desk gates elsewhere mark
              actionability; red and green here describe short-term bias and intraday position only.
            </p>
          </div>
        </SubsectionCard>

        {/* Phase A2 — collapse-back button at the bottom of the expanded ladder. */}
        {!collapsed ? (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: spacing[1] }}>
            <button
              type="button"
              data-testid="shared-context-toggle"
              data-shared-context-collapsed="false"
              aria-expanded={true}
              onClick={toggleCollapsed}
              className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-semibold"
              style={{
                border: `1px solid ${colors.border}`,
                color: colors.textMuted,
                background: colors.surfaceMuted
              }}
            >
              <ChevronUp size={14} aria-hidden />
              Hide full breakdown
            </button>
          </div>
        ) : null}
        </div>
      </div>
  );

  if (layout === "embedded") {
    return (
      <div
        data-testid="swing-desk-market-backdrop"
        className={surfaceGlowClassName}
        style={{
          borderRadius: borderRadius.lg,
          border: `1px solid color-mix(in srgb, ${colors.border} 82%, rgba(168,85,247,0.38))`,
          background: `linear-gradient(165deg, color-mix(in srgb, rgba(168,85,247,0.09), ${colors.surfaceMuted}) 0%, ${colors.surfaceMuted} 100%)`,
          padding: spacing[4],
          marginBottom: spacing[2]
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3" style={{ marginBottom: spacing[3] }}>
          <div style={{ minWidth: 0, flex: "1 1 220px" }}>
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
              Market backdrop
            </p>
            <p
              style={{
                margin: `${spacing[2]} 0 0 0`,
                fontSize: typography.scale.sm,
                color: colors.textMuted,
                lineHeight: 1.5
              }}
            >
              Indexes, volatility, breadth, and catalysts that frame swing decisions — consolidated here on Swing Pro (no separate shared card).
            </p>
          </div>
          {sessionStatusStrip}
        </div>
        {contextGrid}
      </div>
    );
  }

  return (
    <DashboardCard
      role="shared"
      eyebrow="All timeframes · used by both desks"
      title="Shared Context"
      subtitle="Market backdrop and constraints — descriptive context only. Not a trade signal; red/green here is tape state, not desk permission to trade."
      cardTip={WEEKLY_MARKET_CONTEXT_CARD_TIP}
      data-testid="shared-context-master-card"
      headerRight={sessionStatusStrip}
    >
      {contextGrid}
    </DashboardCard>
  );
}

// Phase 2c — the former `SignalValidationLedgerTertiarySurface` (tracked
// outcomes link card that lived BELOW the three master cards) has been removed
// from the dashboard entirely. Per the user's directive, tracked outcomes are
// not market context, so the dashboard is now exclusively the home of
// market-environment + decision-desk content. The full ledger remains
// accessible from the Performance page (see `PerformanceLedgerLink` in
// `performance-tracking-content.tsx`) and from the dashboard nav.
