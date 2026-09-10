"use client";

import { borderRadius, roleAccents, spacing, typography } from "@/lib/design-system";
import type { DeepDiveLane, FeedLane } from "@/lib/dashboard/trading-room/feed-model";
import type { FeedState } from "@/lib/dashboard/trading-room/feed-model";
import type { useTheme } from "@/lib/theme-provider";

type Colors = ReturnType<typeof useTheme>["colors"];

function LaneStateDot({ state, colors }: { state: FeedState | null; colors: Colors }) {
  if (!state) return null;
  const tone =
    state === "actionable"
      ? colors.bullish
      : state === "near"
        ? colors.caution
        : state === "cooling"
          ? colors.bearish
          : colors.textMuted;
  return (
    <span
      aria-hidden
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: tone,
        flexShrink: 0,
        boxShadow: state === "actionable" ? `0 0 8px ${tone}99` : undefined
      }}
    />
  );
}

/**
 * Day / Swing / Position segmented control — desk-colored pills with a clear active state.
 * Position is always available (symbol lookup); day/swing show feed-state dots when known.
 */
export function DeepDiveLaneToggle({
  activeLane,
  onChange,
  dayState,
  swingState,
  symbol,
  colors
}: {
  activeLane: DeepDiveLane;
  onChange: (lane: DeepDiveLane) => void;
  dayState: FeedState | null;
  swingState: FeedState | null;
  symbol: string;
  colors: Colors;
}) {
  const dayAccent = roleAccents.dark.day;
  const swingAccent = roleAccents.dark.swing;
  const positionAccent = roleAccents.dark.position;

  const btn = (
    lane: DeepDiveLane,
    label: string,
    laneState: FeedState | null | "always",
    accent: (typeof roleAccents)["dark"]["day"],
    tooltip?: string
  ) => {
    const active = activeLane === lane;
    const available = laneState === "always" || laneState !== null;
    const rail = accent.borderAccent;
    const text = accent.accentStrong;

    return (
      <button
        key={lane}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onChange(lane)}
        title={tooltip}
        style={{
          border: "none",
          background: active ? `${rail}30` : "transparent",
          boxShadow: active ? `inset 0 0 0 1.5px ${rail}, 0 0 14px ${rail}40` : "none",
          color: active ? text : colors.textMuted,
          fontSize: typography.scale.sm,
          fontWeight: 700,
          padding: "7px 14px",
          borderRadius: borderRadius.full,
          cursor: "pointer",
          letterSpacing: "0.03em",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          opacity: available || active ? 1 : 0.55,
          transition: "background .14s, color .14s, box-shadow .14s, opacity .14s",
          whiteSpace: "nowrap"
        }}
      >
        {laneState !== "always" ? <LaneStateDot state={laneState} colors={colors} /> : null}
        {label}
      </button>
    );
  };

  return (
    <div
      role="tablist"
      aria-label={`${symbol} desk mode`}
      data-testid="deep-dive-lane-toggle"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: 4,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.full,
        background: colors.background,
        flexShrink: 0,
        flexWrap: "wrap"
      }}
    >
      {btn("day", "Day", dayState, dayAccent, dayState === null ? `No day setup for ${symbol} in today's feed` : undefined)}
      {btn("swing", "Swing", swingState, swingAccent, swingState === null ? `No swing setup for ${symbol} in today's feed` : undefined)}
      {btn(
        "position",
        "Long Term",
        "always",
        positionAccent,
        "Long-horizon fundamentals + weekly structure (lookup any symbol)"
      )}
    </div>
  );
}
