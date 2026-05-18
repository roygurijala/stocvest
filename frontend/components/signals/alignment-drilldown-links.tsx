"use client";

import Link from "next/link";
import {
  setupEvolutionHubHref,
  signalsLayersSectionHref,
  signalsOpenEvidenceHref
} from "@/lib/nav/setup-analytics-deeplink";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  symbol: string;
  mode: "swing" | "day";
  /** When on Signals, prefer in-page handlers over full navigation. */
  onOpenEvidence?: () => void;
  onScrollToEvolution?: () => void;
  /** When true, "Layers" scrolls to #signals-layers on the current Signals page. */
  samePageLayers?: boolean;
  testId?: string;
};

export function AlignmentDrilldownLinks({
  symbol,
  mode,
  onOpenEvidence,
  onScrollToEvolution,
  samePageLayers = false,
  testId = "alignment-drilldown-links"
}: Props) {
  const { colors } = useTheme();
  const symU = symbol.trim().toUpperCase();
  const linkStyle = {
    fontSize: 12,
    fontWeight: 600 as const,
    color: colors.accent,
    textDecoration: "none" as const
  };

  const layersHref = samePageLayers
    ? `${signalsLayersSectionHref(symU, mode)}`
    : signalsOpenEvidenceHref(symU, mode);

  return (
    <span
      data-testid={testId}
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5"
      style={{ fontSize: 12, color: colors.textMuted }}
    >
      {onOpenEvidence ? (
        <button
          type="button"
          data-testid={`${testId}-evidence`}
          className="border-0 bg-transparent p-0 font-semibold underline-offset-2 hover:underline"
          style={{ ...linkStyle, cursor: "pointer" }}
          onClick={onOpenEvidence}
        >
          Layer evidence
        </button>
      ) : (
        <Link href={layersHref} data-testid={`${testId}-evidence`} style={linkStyle}>
          Layer evidence
        </Link>
      )}
      <span aria-hidden>·</span>
      {onScrollToEvolution ? (
        <button
          type="button"
          data-testid={`${testId}-evolution`}
          className="border-0 bg-transparent p-0 font-semibold underline-offset-2 hover:underline"
          style={{ ...linkStyle, cursor: "pointer" }}
          onClick={onScrollToEvolution}
        >
          Past states
        </button>
      ) : (
        <Link
          href={setupEvolutionHubHref(symU, mode)}
          data-testid={`${testId}-evolution`}
          style={linkStyle}
        >
          Past states
        </Link>
      )}
    </span>
  );
}
