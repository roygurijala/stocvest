"use client";

import type { CSSProperties, MouseEvent } from "react";

import { borderRadius } from "@/lib/design-system";
import type { useTheme } from "@/lib/theme-provider";
import { formatEvaluatedAgo } from "@/lib/watchlist-decision-card-present";

type Colors = ReturnType<typeof useTheme>["colors"];

export function CardRefreshButton({
  label,
  busy = false,
  colors,
  onRefresh
}: {
  label: string;
  busy?: boolean;
  colors: Colors;
  onRefresh: () => void;
}) {
  const stop = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={(e) => {
        stop(e);
        onRefresh();
      }}
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: borderRadius.sm,
        border: `1px solid ${colors.accent}66`,
        background: `${colors.accent}22`,
        color: colors.accent,
        cursor: busy ? "wait" : "pointer",
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1,
        opacity: busy ? 0.65 : 1
      }}
    >
      {busy ? "…" : "↻"}
    </button>
  );
}

export function laneBadgeStyle(colors: Colors): CSSProperties {
  return {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: colors.textMuted
  };
}

export function FeedCardUpdatedLine({
  iso,
  colors
}: {
  iso: string | null | undefined;
  colors: Colors;
}) {
  const { text, stale } = formatEvaluatedAgo(iso ?? undefined);
  return (
    <span
      data-testid="feed-card-updated"
      style={{
        fontSize: 10,
        color: stale ? colors.caution : colors.textMuted,
        lineHeight: 1.35
      }}
    >
      Updated {text}
      {stale && iso?.trim() ? " · stale" : null}
    </span>
  );
}
