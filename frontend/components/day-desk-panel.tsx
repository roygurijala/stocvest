"use client";

/**
 * Day Desk panel — rendered on the dashboard beneath the Swing Desk.
 *
 * Mode Separation B28 (Phase 1). The Day Desk is an INDEPENDENT decision
 * surface from the Swing Desk: it has its own posture, its own primary content,
 * its own re-enable language, and its own scanner footer link. It MUST render
 * with EQUAL VISUAL WEIGHT to the Swing Desk regardless of whether either side
 * is Active or Suppressed (per the assistant prompt's MODE SEPARATION rule:
 * "If a desk is suppressed, that desk must remain fully visible and dignified.
 * No visual de-emphasis. No minimization. No apology.").
 *
 * Anatomy follows the 5-element spec from the prompt:
 *   ① Header   — identity + time horizon (`DAY DESK · Intraday (session-bound)`)
 *   ② Posture  — pill (Active / Monitor-only / Suppressed) — always above content
 *   ③ Primary  — top day signals OR suppression copy (mutually exclusive)
 *   ④ Re-enable — what would bring intraday rows back (day vocabulary only)
 *   ⑤ Footer   — link to `/dashboard/scanner?mode=day`
 *
 * This file does NOT import any swing-side helpers. The Day Desk's vocabulary,
 * thresholds, and posture mapping are entirely day-side (`lib/dashboard-posture.ts`
 * day helpers). Cross-pollination would silently violate the Mode Separation
 * safety perimeter even if the visual layout is correct.
 */

import { motion } from "framer-motion";
import Link from "next/link";
import { useMemo } from "react";
import type { IntradaySetupPayload, ScannerOverview } from "@/lib/api/scanner";
import type { MarketStatusPayload } from "@/lib/api/market";
import { DashboardCard } from "@/components/dashboard-card";
import { DayDeskSignature } from "@/components/desk-visual-signatures";
import { InfoTip } from "@/components/info-tip";

/**
 * Phase B+ — day-row intraday meta helpers.
 *
 * Mode Separation guard: these helpers consume ONLY day-side fields
 * from `IntradaySetupPayload` (`vwap`, `last_price`, `timestamp_iso`).
 * They MUST NOT read swing-coded fields (`pattern_maturity_days`,
 * `weekly_rsi`, etc.) — the row should feel intraday at a glance,
 * not "another way to render a swing row".
 */
type VwapRelative = { kind: "above" | "below" | "flat"; pct: number } | null;

function vwapRelative(lastPrice: number | null | undefined, vwap: number | null | undefined): VwapRelative {
  if (
    typeof lastPrice !== "number" ||
    !Number.isFinite(lastPrice) ||
    typeof vwap !== "number" ||
    !Number.isFinite(vwap) ||
    vwap === 0
  ) {
    return null;
  }
  const pct = ((lastPrice - vwap) / vwap) * 100;
  if (!Number.isFinite(pct)) return null;
  if (Math.abs(pct) < 0.05) return { kind: "flat", pct };
  return { kind: pct > 0 ? "above" : "below", pct };
}

function minutesAgoLabel(timestampIso: string | null | undefined): string | null {
  if (!timestampIso) return null;
  const t = Date.parse(timestampIso);
  if (!Number.isFinite(t)) return null;
  const deltaSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const m = Math.round(deltaSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return null;
}
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { dashboardTradingRoomHref } from "@/lib/nav/dashboard-trading-room-deeplink";
import { interactionLevelProps } from "@/lib/dashboard/click-hierarchy";
import { useTheme } from "@/lib/theme-provider";
import {
  buildDayReenableBulletsShort,
  dayDeskPostureKind,
  dayDeskSuppressionStatusLine,
  emptyDayOneLiner,
  emptyDayPostureHeadline,
  type DayDeskPostureKind
} from "@/lib/dashboard-posture";

const DAY_DESK_CARD_TIP =
  "The Day Desk shows the intraday engine's posture (Active / Monitor-only / Suppressed), top day setups, and what would re-enable rows. It is INDEPENDENT of the Swing Desk — one desk being Active does not comment on the other. Day signals follow intraday gates (volume / momentum / session structure), not the multi-day cadence used by the Swing Desk.";

const DAY_DESK_PRIMARY_READ_TIP =
  "Day Desk posture answers 'Am I even allowed to act intraday?'. Active = at least one intraday symbol cleared volume + momentum gates this load. Monitor-only = setups present but score below the floor (0.55). Suppressed = either session closed (regular hours not open) or no intraday confirmation in-session.";

const DAY_DESK_REENABLE_TIP =
  "Intraday rows return when volume / momentum / session structure clears the day scanner's gates. This is NOT a forecast — it's a checklist of the conditions the scanner is gating on right now.";

type DayDeskPanelProps = {
  /** All setups returned by the scanner; the Day Desk partitions to `scanner_mode !== "swing_daily"`. */
  setups: ScannerOverview["setups"];
  marketStatus: MarketStatusPayload | undefined | null;
  scannerError?: string;
  /** Cap on rendered top day signals (default 4). Discipline > abundance — top signals stay small. */
  topSignalCap?: number;
};

/** Top day setup score, for posture computation. Returns null when no day setups present. */
function topDaySetupScore(daySetups: IntradaySetupPayload[]): number | null {
  let best: number | null = null;
  for (const s of daySetups) {
    if (typeof s.score === "number" && Number.isFinite(s.score)) {
      if (best == null || s.score > best) best = s.score;
    }
  }
  return best;
}

/** Compact day-signal row. Deliberately simpler than the Swing Desk's Evidence card pattern —
 *  the dashboard is a SUMMARY surface; the full intraday workflow lives on /dashboard/scanner?mode=day
 *  and /dashboard/signals?trading_mode=day. */
function DayTopSignalRow({
  signal,
  index
}: {
  signal: IntradaySetupPayload;
  index: number;
}) {
  const { colors } = useTheme();
  const dirRaw = signal.direction || "";
  const isLong = ["bullish", "long"].includes(dirRaw.toLowerCase());
  const pct = typeof signal.score === "number" && Number.isFinite(signal.score)
    ? Math.round(signal.score * 100)
    : null;
  const rowHref = dashboardTradingRoomHref(signal.symbol.trim().toUpperCase(), "day", {
    ref: "dashboard-day-desk"
  });
  const rowHoverPrefetch = useHoverPrefetch(rowHref);
  return (
    <motion.article
      key={`day-${signal.symbol}-${index}`}
      {...interactionLevelProps("none")}
      className={`flex flex-col gap-2 ${surfaceGlowClassName}`}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08 }}
      style={{
        position: "relative",
        background: `linear-gradient(160deg, color-mix(in srgb, ${colors.accent} 6%, ${colors.surfaceMuted}) 0%, ${colors.surfaceMuted} 100%)`,
        border: `1px solid color-mix(in srgb, ${colors.border} 88%, ${colors.accent} 12%)`,
        borderRadius: borderRadius.lg,
        padding: spacing[3]
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2], flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing[2], minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: typography.scale.base }}>{signal.symbol}</p>
          <span
            style={{
              background: isLong ? "rgba(34,197,94,.2)" : "rgba(239,68,68,.2)",
              color: isLong ? colors.bullish : colors.bearish,
              borderRadius: borderRadius.full,
              padding: "2px 8px",
              fontSize: typography.scale.xs,
              fontWeight: 600,
              textTransform: "lowercase"
            }}
          >
            {dirRaw}
          </span>
          <span
            style={{
              background: "rgba(148,163,184,0.14)",
              color: colors.textMuted,
              borderRadius: borderRadius.full,
              padding: "2px 8px",
              fontSize: typography.scale.xs,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em"
            }}
            title="Intraday session-bound setup; cadence differs from the Swing Desk."
          >
            Intraday
          </span>
        </div>
        {pct != null ? (
          <span style={{ color: colors.text, fontSize: typography.scale.sm, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {pct}%
          </span>
        ) : null}
      </div>
      {signal.company_name?.trim() ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.4 }}>
          {signal.company_name.trim()}
        </p>
      ) : null}
      {signal.triggers && signal.triggers.length > 0 ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.45 }}>
          {signal.triggers.slice(0, 2).join(" · ")}
        </p>
      ) : null}
      {/*
       * Phase B+ — intraday-language meta strip. VWAP-relative tag
       * + last price + time-since-trigger. These three fields are
       * the canonical intraday "is this still alive?" reads — they
       * NEVER appear on Swing rows because they are session-scoped
       * by design (Mode Separation). Each chip is optional so the
       * row degrades gracefully when payload fields are missing
       * (older `IntradaySetupPayload` snapshots, day setups built
       * from gap-with-catalyst flow that lacks VWAP, etc.).
       */}
      <div className="flex flex-wrap items-center gap-2" data-testid="day-row-intraday-meta">
        {(() => {
          const rel = vwapRelative(signal.last_price, signal.vwap);
          if (!rel) return null;
          const tone =
            rel.kind === "above"
              ? { fg: colors.bullish, bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.34)" }
              : rel.kind === "below"
                ? { fg: colors.bearish, bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.34)" }
                : { fg: colors.textMuted, bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.28)" };
          const sign = rel.pct >= 0 ? "+" : "";
          return (
            <span
              data-testid="day-row-vwap-chip"
              data-vwap-direction={rel.kind}
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: tone.fg,
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                borderRadius: borderRadius.full,
                padding: "2px 8px",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontVariantNumeric: "tabular-nums"
              }}
            >
              {rel.kind === "flat"
                ? "At VWAP"
                : `${rel.kind === "above" ? "Above" : "Below"} VWAP ${sign}${rel.pct.toFixed(2)}%`}
            </span>
          );
        })()}
        {typeof signal.last_price === "number" && Number.isFinite(signal.last_price) ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
            Last <span style={{ color: colors.text, fontWeight: 600 }}>${signal.last_price.toFixed(2)}</span>
          </span>
        ) : null}
        {(() => {
          const tLabel = minutesAgoLabel(signal.timestamp_iso);
          if (!tLabel) return null;
          return (
            <span
              data-testid="day-row-triggered-at"
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.06em"
              }}
              title="Time since this intraday signal was last refreshed by the scanner."
            >
              · Triggered {tLabel}
            </span>
          );
        })()}
      </div>
      {/* Perf invariant — see docs/PERFORMANCE.md §3.1 + §4C.
          Each day-row chip points at `/dashboard/signals` (a heavy
          SSR page). The Day Desk renders up to `topSignalCap=4`
          rows; with `prefetch="auto"` (the Next.js default) this
          would fire 4 parallel SSR prefetches at mount, stacked on
          top of the ribbon chips and the swing desk. `prefetch=
          {false}` keeps clicks fast (router cache still applies)
          while removing the speculative drain. Layer 4 adds
          hover-prefetch so the route warms when the user is about
          to click instead of on mount. */}
      <Link
        href={rowHref}
        prefetch={false}
        data-hover-prefetch="true"
        {...interactionLevelProps("deep")}
        onMouseEnter={rowHoverPrefetch.onMouseEnter}
        onFocus={rowHoverPrefetch.onFocus}
        onPointerDown={rowHoverPrefetch.onPointerDown}
        style={{
          alignSelf: "flex-start",
          marginTop: spacing[1],
          fontSize: typography.scale.xs,
          color: colors.accent,
          fontWeight: 600
        }}
      >
        Open Day Signals →
      </Link>
    </motion.article>
  );
}

export function DayDeskPanel({ setups, marketStatus, scannerError, topSignalCap = 4 }: DayDeskPanelProps) {
  const { colors } = useTheme();
  const dayScannerHoverPrefetch = useHoverPrefetch("/dashboard/scanner?mode=day");

  const daySetups = useMemo(
    () =>
      [...setups].filter(
        (s) =>
          s.scanner_mode !== "swing_daily" &&
          typeof s.score === "number" &&
          Number.isFinite(s.score)
      ),
    [setups]
  );
  const dayTopSignals = useMemo(
    () => [...daySetups].sort((a, b) => b.score - a.score).slice(0, topSignalCap),
    [daySetups, topSignalCap]
  );
  const topScore = useMemo(() => topDaySetupScore(daySetups), [daySetups]);
  const postureKind: DayDeskPostureKind = useMemo(
    () =>
      dayDeskPostureKind({
        marketStatus: marketStatus ?? undefined,
        daySetupCount: daySetups.length,
        daySetupTopScore: topScore,
        scannerError
      }),
    [marketStatus, daySetups.length, topScore, scannerError]
  );
  const headline = emptyDayPostureHeadline(postureKind);
  const oneLiner = emptyDayOneLiner(postureKind, marketStatus ?? undefined);
  const suppressionStatusLine = dayDeskSuppressionStatusLine(postureKind);
  const reenableBullets = useMemo(
    () =>
      buildDayReenableBulletsShort({
        marketStatus: marketStatus ?? undefined,
        daySetupCount: daySetups.length
      }),
    [marketStatus, daySetups.length]
  );

  const showSignals = postureKind === "active" || postureKind === "monitor";

  return (
    <DashboardCard
      role="day"
      eyebrow="Intraday · session-bound"
      title="Day Desk"
      subtitle="Intraday engine — session-bound. Independent of the Swing Desk. Posture (Active / Monitor / Suppressed) reflects today's volume / momentum / session-structure gates, not multi-day cadence."
      cardTip={DAY_DESK_CARD_TIP}
      headerRight={<DayDeskSignature marketStatus={marketStatus ?? undefined} />}
      data-testid="day-desk-panel"
      data-day-desk-posture={postureKind}
    >
      <div className="flex flex-col gap-4" data-testid="day-desk-body">
        {/* ② Posture pill */}
        <DayDeskPosturePill kind={postureKind} />

        {/* ③ Primary content — signals OR suppression copy (mutually exclusive) */}
        {showSignals && dayTopSignals.length > 0 ? (
          <div className="flex flex-col gap-3" data-testid="day-desk-signals">
            {dayTopSignals.map((signal, index) => (
              <DayTopSignalRow key={`${signal.symbol}-${index}`} signal={signal} index={index} />
            ))}
          </div>
        ) : (
          <motion.div
            key={`day-suppression-${postureKind}`}
            data-testid="day-desk-suppression"
            className={surfaceGlowClassName}
            initial={{ opacity: 0.88, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, ease: "easeOut" }}
            style={{
              borderRadius: borderRadius.xl,
              border: `1px solid color-mix(in srgb, ${colors.border} 72%, transparent)`,
              background: `color-mix(in srgb, ${colors.textMuted} 6%, ${colors.surface})`,
              padding: spacing[5],
              display: "grid",
              gap: spacing[3]
            }}
          >
            <div className="inline-flex flex-wrap items-center gap-2">
              <p
                style={{
                  margin: 0,
                  fontSize: 10,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: colors.textMuted,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: spacing[2]
                }}
              >
                {/* Phase D — subtle pulse next to the day-desk "Primary read"
                    title to communicate the engine is still listening even
                    when suppression copy is shown. */}
                <span
                  aria-hidden
                  className="stocvest-pulse-dot"
                  style={{ background: colors.textMuted }}
                />
                Primary read
              </p>
              <InfoTip text={DAY_DESK_PRIMARY_READ_TIP} label="What this day primary read means" maxWidth={340} />
            </div>
            <p style={{ margin: 0, fontSize: typography.scale.base, fontWeight: 600, color: colors.text, lineHeight: 1.35 }}>
              {headline}
            </p>
            <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 500, color: colors.textMuted, lineHeight: 1.5 }}>
              {oneLiner}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: typography.scale.sm,
                fontWeight: 500,
                color: colors.textMuted,
                lineHeight: 1.45,
                letterSpacing: "0.02em"
              }}
            >
              {suppressionStatusLine}
            </p>
          </motion.div>
        )}

        {/* ④ "What would re-enable" — DAY-VOCABULARY ONLY */}
        <div style={{ display: "grid", gap: spacing[2] }} data-testid="day-desk-reenable">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
            <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.textMuted }}>
              What would re-enable day setups
            </span>
            <InfoTip text={DAY_DESK_REENABLE_TIP} label="What would bring day rows back" maxWidth={340} />
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: spacing[4],
              color: colors.textMuted,
              fontSize: typography.scale.sm,
              lineHeight: 1.55,
              fontWeight: 400,
              display: "grid",
              gap: spacing[2]
            }}
          >
            {reenableBullets.map((b, idx) => (
              <li key={idx} style={{ color: colors.text }}>
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* ⑤ Footer — minimal link to the full intraday workflow */}
        <div
          style={{
            borderTop: `1px solid ${colors.border}`,
            paddingTop: spacing[3],
            marginTop: spacing[1]
          }}
        >
          {/* Perf invariant — see docs/PERFORMANCE.md §3.1.
              `/dashboard/scanner` is a heavy SSR target; the desk
              footer is on every dashboard render. Default
              `prefetch="auto"` would prefetch the full scanner SSR
              page just because the footer is visible below the
              fold. We disable it. */}
          <Link
            href="/dashboard/scanner?mode=day"
            prefetch={false}
            data-hover-prefetch="true"
            {...interactionLevelProps("deep")}
            onMouseEnter={dayScannerHoverPrefetch.onMouseEnter}
            onFocus={dayScannerHoverPrefetch.onFocus}
            onPointerDown={dayScannerHoverPrefetch.onPointerDown}
            className="inline-flex min-h-11 items-center font-semibold"
            style={{ color: colors.accent, fontSize: typography.scale.sm }}
          >
            View day scanner →
          </Link>
        </div>
      </div>
    </DashboardCard>
  );
}

/** Posture pill — Active / Monitor-only / Suppressed. Mode-colored subtly,
 *  never green/red profit cues. Always above any signals (per the prompt's
 *  rendering rule "② Desk posture (the most important visual element)"). */
function DayDeskPosturePill({ kind }: { kind: DayDeskPostureKind }) {
  const { colors } = useTheme();
  const tone =
    kind === "active"
      ? { label: "Active", glyph: "✓", accent: colors.bullish }
      : kind === "monitor"
        ? { label: "Monitor-only", glyph: "○", accent: colors.caution }
        : { label: "Suppressed", glyph: "—", accent: colors.textMuted };
  return (
    <div
      data-testid="day-desk-posture-pill"
      data-day-desk-posture-label={tone.label.toLowerCase()}
      className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide"
      style={{
        borderColor: `color-mix(in srgb, ${tone.accent} 35%, ${colors.border})`,
        background: "rgba(148,163,184,0.08)",
        color: tone.accent
      }}
    >
      <span aria-hidden style={{ fontSize: typography.scale.sm, lineHeight: 1 }}>
        {tone.glyph}
      </span>
      <span>Day Desk · {tone.label}</span>
    </div>
  );
}
