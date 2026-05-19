"use client";

import { CircleHelp } from "lucide-react";
import { maturationFrequencyTooltip } from "@/lib/maturation-expected-frequency";
import type { MaturationFrequencyDesk } from "@/lib/maturation-expected-frequency";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  desk: MaturationFrequencyDesk;
};

/** Cadence + layer bands — native tooltip; ask the assistant for more detail. */
export function WatchlistEvaluationInfoTip({ desk }: Props) {
  const { colors } = useTheme();
  const tooltip = maturationFrequencyTooltip(desk);

  return (
    <button
      type="button"
      data-testid="watchlist-evaluation-info"
      className="inline-flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0.5"
      style={{ color: colors.textMuted }}
      title={tooltip}
      aria-label="How watchlist evaluation works. Hover for a short summary, or ask the assistant."
    >
      <CircleHelp className="h-4 w-4" aria-hidden />
    </button>
  );
}
