"use client";

import Link from "next/link";
import { Activity, BarChart3, Compass, Layers } from "lucide-react";
import { borderRadius, roleAccents, spacing, typography } from "@/lib/design-system";
import {
  formatTapeReadout,
  type DayEmptyStateContext,
  type ScannerEmptyStateContext,
  type SwingEmptyStateContext
} from "@/lib/scanner-empty-state";
import { SECTION_LABEL_DAY_DESK, SECTION_LABEL_SWING_DESK } from "@/lib/mode-terminology";
import { useTheme } from "@/lib/theme-provider";

interface ScannerEmptyStateCardProps {
  context: ScannerEmptyStateContext;
  /**
   * Compact mode for narrow grid cells (e.g. when the Gap Intelligence
   * column is half-width). Drops the inline cross-link strip.
   */
  compact?: boolean;
  /** Optional override for the `data-testid` so tests can target each instance. */
  testId?: string;
}

/**
 * Scanner empty-state card.
 *
 * Replaces the prior single-line "No swing setups — regime and structure
 * not aligned." UI with a structured, calm explanation of:
 *
 *   1. **What the scanner did** (universe size, market regime, tape).
 *   2. **Why nothing fired** (one-liner explainer, observational).
 *   3. **What would bring rows back** (re-enable bullets — same copy the
 *      dashboard uses on the Swing Desk / Day Desk re-enable widgets so
 *      the user gets the same vocabulary across surfaces).
 *   4. **Cross-links** to the Signal Validation ledger, the Dashboard,
 *      and the watchlist — the three surfaces a user can productively
 *      use when nothing is firing right now.
 *
 * **Visual contract**
 *
 * Role-coded accents: indigo-violet for Swing, teal-cyan for Day —
 * matches the dashboard's Swing Desk / Day Desk hues, so a Scanner
 * empty-state card visually reads as the same engine the user just saw
 * on the dashboard.
 *
 * **Language contract**
 *
 * Every line follows the Mode Separation rules. Swing-side cards never
 * use day-side vocabulary (intraday confirmation / VWAP / ORB / RVOL)
 * and vice versa. The lock-in tests pin this — see
 * `tests/scanner-empty-state.test.tsx`.
 */
export function ScannerEmptyStateCard({
  context,
  compact = false,
  testId
}: ScannerEmptyStateCardProps) {
  const { colors, theme } = useTheme();
  const role = context.mode === "swing" ? "swing" : "day";
  const accent = roleAccents[theme][role];
  const railHue = accent.borderAccent;
  const deskLabel = context.mode === "swing" ? SECTION_LABEL_SWING_DESK : SECTION_LABEL_DAY_DESK;
  const tape = formatTapeReadout(context.spyPct, context.qqqPct);
  const universeChip =
    typeof context.universeSize === "number" && context.universeSize > 0
      ? `${context.universeSize} symbols scanned`
      : null;
  const regimeChip = context.regimeLabel ? `Regime: ${context.regimeLabel}` : null;
  const tapeChip = tape || null;
  const chips: Array<{ icon: typeof Activity; label: string }> = [];
  if (universeChip) chips.push({ icon: Layers, label: universeChip });
  if (regimeChip) chips.push({ icon: Compass, label: regimeChip });
  if (tapeChip) chips.push({ icon: BarChart3, label: tapeChip });

  return (
    <div
      data-testid={testId ?? `scanner-empty-state-${context.mode}`}
      data-mode={context.mode}
      style={{
        display: "grid",
        gap: spacing[3],
        padding: spacing[4],
        background: `color-mix(in srgb, ${railHue} 6%, ${colors.surface})`,
        border: `1.5px solid ${railHue}`,
        borderRadius: borderRadius.lg,
        position: "relative",
        overflow: "hidden"
      }}
    >
      {/* Role rail — bright top stripe so the desk identity reads at a glance, matches dashboard cards. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: railHue
        }}
      />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing[3] }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: spacing[2],
            color: railHue,
            fontWeight: 700,
            fontSize: typography.scale.xs,
            letterSpacing: "0.08em",
            textTransform: "uppercase"
          }}
        >
          <Activity size={14} aria-hidden />
          {accent.pillLabel}
        </span>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{deskLabel}</span>
      </div>

      <h4
        data-testid={`scanner-empty-state-${context.mode}-headline`}
        style={{
          margin: 0,
          color: colors.text,
          fontSize: typography.scale.base,
          fontWeight: 700,
          lineHeight: 1.35
        }}
      >
        {context.headline}
      </h4>

      <p
        style={{
          margin: 0,
          color: colors.textMuted,
          fontSize: typography.scale.sm,
          lineHeight: 1.55
        }}
      >
        {context.oneLiner}
      </p>

      {chips.length > 0 ? (
        <div
          data-testid={`scanner-empty-state-${context.mode}-context-strip`}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: spacing[2],
            paddingTop: spacing[2],
            borderTop: `1px dashed ${colors.border}`
          }}
        >
          {chips.map((chip) => {
            const Icon = chip.icon;
            return (
              <span
                key={chip.label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: `${spacing[1]} ${spacing[2]}`,
                  borderRadius: borderRadius.full,
                  background: `color-mix(in srgb, ${railHue} 10%, ${colors.surface})`,
                  border: `1px solid ${colors.border}`,
                  fontSize: typography.scale.xs,
                  color: colors.text
                }}
              >
                <Icon size={11} aria-hidden style={{ color: railHue }} />
                {chip.label}
              </span>
            );
          })}
        </div>
      ) : null}

      <details
        data-testid={`scanner-empty-state-${context.mode}-reenable`}
        style={{
          background: colors.background,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
          padding: `${spacing[2]} ${spacing[3]}`
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontSize: typography.scale.sm,
            fontWeight: 600,
            color: colors.text,
            listStyle: "revert"
          }}
        >
          What would re-enable {context.mode === "swing" ? "swing" : "day"} rows
        </summary>
        <ul
          style={{
            margin: `${spacing[2]} 0 0 0`,
            paddingLeft: spacing[5],
            display: "grid",
            gap: spacing[2]
          }}
        >
          {context.reenableBullets.map((bullet, idx) => (
            <li
              key={idx}
              style={{
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                lineHeight: 1.55
              }}
            >
              {bullet}
            </li>
          ))}
        </ul>
        <p
          style={{
            margin: `${spacing[2]} 0 0`,
            fontSize: 10,
            color: colors.textMuted,
            fontStyle: "italic",
            lineHeight: 1.4
          }}
        >
          These are the gates the {context.mode === "swing" ? "swing" : "day"} engine evaluates — not a prediction of outcomes. Satisfying a single gate does not produce a setup.
        </p>
      </details>

      {compact ? null : (
        <nav
          data-testid={`scanner-empty-state-${context.mode}-crosslinks`}
          aria-label={`What to do while ${deskLabel} is quiet`}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: spacing[2],
            paddingTop: spacing[2],
            borderTop: `1px dashed ${colors.border}`
          }}
        >
          <EmptyStateLink
            href="/dashboard/signal-validation"
            railHue={railHue}
            borderColor={colors.border}
            textColor={colors.text}
            label="Browse signal validation"
            sublabel="Historical accuracy by mode"
          />
          <EmptyStateLink
            href="/dashboard/watchlist"
            railHue={railHue}
            borderColor={colors.border}
            textColor={colors.text}
            label="Edit your watchlist"
            sublabel="Set what you want scanned next"
          />
          <EmptyStateLink
            href="/dashboard"
            railHue={railHue}
            borderColor={colors.border}
            textColor={colors.text}
            label="Back to dashboard"
            sublabel={`See full ${deskLabel} posture`}
          />
        </nav>
      )}
    </div>
  );
}

function EmptyStateLink({
  href,
  railHue,
  borderColor,
  textColor,
  label,
  sublabel
}: {
  href: string;
  railHue: string;
  borderColor: string;
  textColor: string;
  label: string;
  sublabel: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 2,
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${borderColor}`,
        background: "transparent",
        color: textColor,
        textDecoration: "none",
        transition: "border-color 120ms ease, background 120ms ease"
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = railHue;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = borderColor;
      }}
    >
      <span style={{ fontSize: typography.scale.sm, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 10, color: railHue, letterSpacing: "0.04em" }}>{sublabel}</span>
    </Link>
  );
}

/**
 * Compact convenience export — narrow variant used inside the Gap
 * Intelligence column where the surface is half-width. Drops the
 * cross-link nav so the card doesn't dominate the column.
 */
export function ScannerEmptyStateCardCompact({
  context,
  testId
}: {
  context: SwingEmptyStateContext | DayEmptyStateContext;
  testId?: string;
}) {
  return <ScannerEmptyStateCard context={context} compact testId={testId} />;
}
