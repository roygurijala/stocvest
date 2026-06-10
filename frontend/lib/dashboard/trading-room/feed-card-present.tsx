"use client";

import { formatEvaluatedAgo } from "@/lib/watchlist-decision-card-present";
import type { useTheme } from "@/lib/theme-provider";

type Colors = ReturnType<typeof useTheme>["colors"];

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
