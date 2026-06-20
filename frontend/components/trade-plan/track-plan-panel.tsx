"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { useTheme } from "@/lib/theme-provider";
import { buildDataQualityFlags } from "@/lib/trade-plan/data-quality-present";
import type { LiveVsPlanDiff } from "@/lib/trade-plan/plan-status";
import type { TrackedPlan } from "@/lib/trade-plan/types";

type Colors = ReturnType<typeof useTheme>["colors"];

function toneForThesis(status: LiveVsPlanDiff["thesis"]["status"], colors: Colors): string {
  if (status === "valid") return colors.bullish;
  if (status === "weakened") return colors.caution;
  return colors.bearish;
}

function toneForTrigger(status: LiveVsPlanDiff["trigger"]["status"], colors: Colors): string {
  if (status === "enter_now") return colors.bullish;
  if (status === "wait_for_entry") return colors.caution;
  return colors.textMuted;
}

export function DataQualityStrip({
  flags,
  colors
}: {
  flags: ReturnType<typeof buildDataQualityFlags>;
  colors: Colors;
}) {
  if (flags.length === 0) return null;
  return (
    <div
      data-testid="data-quality-strip"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginBottom: spacing[2]
      }}
    >
      {flags.map((f) => (
        <p
          key={f.id}
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            lineHeight: 1.45,
            color: f.severity === "warn" ? colors.caution : colors.textMuted,
            fontWeight: f.severity === "warn" ? 600 : 500
          }}
        >
          {f.severity === "warn" ? "⚠ " : ""}{f.label}
        </p>
      ))}
    </div>
  );
}

export function TrackPlanPanel({
  plan,
  diff,
  onTrack,
  onClear,
  trackingDisabled,
  trackDisabledReason,
  dataQualityFlags,
  colors
}: {
  plan: TrackedPlan | null;
  diff: LiveVsPlanDiff | null;
  onTrack: () => void;
  onClear: () => void;
  trackingDisabled?: boolean;
  trackDisabledReason?: string | null;
  dataQualityFlags: ReturnType<typeof buildDataQualityFlags>;
  colors: Colors;
}) {
  const sectionStyle: CSSProperties = {
    background: colors.surfaceMuted,
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.md,
    padding: spacing[3]
  };

  return (
    <article data-testid="track-plan-panel" style={{ display: "flex", flexDirection: "column", gap: spacing[3] }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
        <p
          style={{
            margin: 0,
            flex: "1 1 auto",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "1.2px",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          Trade plan
        </p>
        {!plan ? (
          <button
            type="button"
            data-testid="track-plan-button"
            disabled={trackingDisabled}
            onClick={onTrack}
            style={{
              border: "none",
              borderRadius: borderRadius.sm,
              padding: `${spacing[2]} ${spacing[3]}`,
              background: trackingDisabled ? colors.surfaceMuted : colors.accent,
              color: trackingDisabled ? colors.textMuted : "#fff",
              fontSize: typography.scale.xs,
              fontWeight: 700,
              cursor: trackingDisabled ? "not-allowed" : "pointer"
            }}
          >
            Track this plan
          </button>
        ) : (
          <button
            type="button"
            data-testid="clear-tracked-plan-button"
            onClick={onClear}
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.sm,
              padding: `${spacing[2]} ${spacing[3]}`,
              background: colors.surface,
              color: colors.textMuted,
              fontSize: typography.scale.xs,
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Clear tracked plan
          </button>
        )}
      </div>
      {trackDisabledReason && !plan ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
          {trackDisabledReason}
        </p>
      ) : null}
      <DataQualityStrip flags={dataQualityFlags} colors={colors} />
      {plan && diff ? (
        <p style={{ margin: "0 0 8px", fontSize: typography.scale.xs }}>
          <Link href="/dashboard/plans" style={{ color: colors.accent, fontWeight: 600, textDecoration: "none" }}>
            View all trade plans →
          </Link>
        </p>
      ) : null}
      {plan && diff ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: spacing[3]
          }}
        >
          <div style={sectionStyle} data-testid="tracked-plan-snapshot">
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "1px",
                textTransform: "uppercase",
                color: colors.textMuted
              }}
            >
              Your plan (frozen)
            </p>
            {diff.planLines.map((line) => (
              <p key={line} style={{ margin: "0 0 4px", fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.45 }}>
                {line}
              </p>
            ))}
          </div>
          <div style={sectionStyle} data-testid="live-plan-read">
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "1px",
                textTransform: "uppercase",
                color: colors.textMuted
              }}
            >
              Live read
            </p>
            <p style={{ margin: "0 0 6px", fontSize: typography.scale.xs, fontWeight: 700, color: toneForThesis(diff.thesis.status, colors) }}>
              {diff.thesis.label}
            </p>
            <p style={{ margin: "0 0 8px", fontSize: 10.5, color: colors.textMuted, lineHeight: 1.45 }}>
              {diff.thesis.hint}
            </p>
            <p style={{ margin: "0 0 6px", fontSize: typography.scale.xs, fontWeight: 700, color: toneForTrigger(diff.trigger.status, colors) }}>
              {diff.trigger.label}
            </p>
            <p style={{ margin: "0 0 8px", fontSize: 10.5, color: colors.textMuted, lineHeight: 1.45 }}>
              {diff.trigger.hint}
            </p>
            {diff.liveLines.map((line) => (
              <p key={line} style={{ margin: "0 0 4px", fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.45 }}>
                {line}
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {plan && diff && diff.managementLines.length > 0 ? (
        <div
          data-testid="plan-management-lines"
          style={{
            ...sectionStyle,
            borderColor: colors.caution,
            background: `${colors.caution}10`
          }}
        >
          {diff.managementLines.map((line, idx) => (
            <p
              key={line}
              style={{
                margin: idx === 0 ? 0 : "6px 0 0",
                fontSize: typography.scale.xs,
                lineHeight: 1.5,
                color: colors.text,
                fontWeight: idx === 0 ? 600 : 500
              }}
            >
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {!plan ? (
        <p style={{ margin: 0, fontSize: 10.5, color: colors.textMuted, lineHeight: 1.5 }}>
          Tracking freezes entry, stop, and targets at commit time. Live scans update separately — they do not rewrite your plan.
        </p>
      ) : null}
    </article>
  );
}
