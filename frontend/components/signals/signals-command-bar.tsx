"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import type { ReactNode } from "react";
import { setupEvolutionHubHref } from "@/lib/nav/setup-analytics-deeplink";
import { SUBHEADING_DAY_CADENCE, SUBHEADING_SWING_CADENCE, TAB_LABEL_DAY, TAB_LABEL_SWING } from "@/lib/mode-terminology";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { WatchlistMaturationLine } from "@/lib/hooks/use-watchlist-maturation-line";
import { WATCHLIST_EVALUATION_HEADER } from "@/lib/product-empty-states";
import {
  SIGNALS_UPDATE_MICROCOPY,
  type SignalEvaluationFreshness
} from "@/lib/signals-evaluation-present";
import { formatLastEvaluatedShort } from "@/lib/watchlist-evaluation-present";

type TradingMode = "day" | "swing";

type Props = {
  symbol: string;
  tradingMode: TradingMode;
  dayTradingSurfaces: boolean;
  watchlistControl: ReactNode;
  /** Scenario Builder CTA — sits beside watchlist under the symbol. */
  scenarioControl?: ReactNode;
  maturationLine: WatchlistMaturationLine | null;
  evaluationFreshness: SignalEvaluationFreshness | null;
  /** True when symbol was restored from sessionStorage (no URL prefill). */
  resumedFromSession?: boolean;
  onTradingModeChange: (mode: TradingMode) => void;
  /** Primary evidence entry — pinned in the command bar while scrolling. */
  onOpenEvidence?: () => void;
};

export function SignalsCommandBar({
  symbol,
  tradingMode,
  dayTradingSurfaces,
  watchlistControl,
  scenarioControl,
  maturationLine,
  evaluationFreshness,
  resumedFromSession = false,
  onTradingModeChange,
  onOpenEvidence
}: Props) {
  const { colors } = useTheme();
  const symU = symbol.trim().toUpperCase();
  const maturationEvaluatedAt = maturationLine?.evaluatedAt
    ? formatLastEvaluatedShort(maturationLine.evaluatedAt)
    : null;
  const freshnessAccent =
    evaluationFreshness?.phase === "refreshing" || evaluationFreshness?.phase === "loading";

  return (
    <article
      className={surfaceGlowClassName}
      data-testid="signals-command-bar"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2
            className="m-0 font-semibold tracking-tight"
            style={{ fontSize: typography.scale["2xl"], color: colors.text, lineHeight: 1.15 }}
          >
            {symU}
          </h2>
          {evaluationFreshness ? (
            <p
              className="m-0 mt-1 text-xs font-medium"
              data-testid="signals-evaluation-freshness"
              style={{
                color: freshnessAccent ? "#00C8DC" : colors.textMuted
              }}
            >
              {evaluationFreshness.label}
            </p>
          ) : null}
          {resumedFromSession ? (
            <p
              className="m-0 mt-0.5 text-[11px] leading-snug"
              data-testid="signals-resumed-session"
              style={{ color: colors.textMuted }}
            >
              Viewing {symU} (previous selection)
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            {watchlistControl}
            {scenarioControl}
            {maturationLine ? (
              <span className="text-xs" style={{ color: colors.textMuted }} data-testid="signals-maturation-line">
                <Link
                  href={setupEvolutionHubHref(symU, tradingMode)}
                  className="font-semibold no-underline hover:underline"
                  style={{ color: colors.text }}
                  data-testid="signals-maturation-line-link"
                >
                  {maturationLine.label}
                </Link>
                {maturationEvaluatedAt ? <> · last evaluated {maturationEvaluatedAt}</> : null}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {onOpenEvidence ? (
            <button
              type="button"
              data-testid="signals-open-evidence-button"
              className="inline-flex min-h-9 items-center justify-center rounded-lg border px-3 text-xs font-semibold sm:text-sm"
              style={{
                borderColor: colors.accent,
                background: `color-mix(in srgb, ${colors.accent} 16%, ${colors.surfaceMuted})`,
                color: colors.text,
                cursor: "pointer"
              }}
              onClick={onOpenEvidence}
            >
              Open full evidence
            </button>
          ) : null}
          {dayTradingSurfaces ? (
          <div
            className="grid shrink-0 grid-cols-2 gap-1 rounded-lg p-1"
            style={{ border: `1px solid ${colors.border}`, background: colors.background, minWidth: 200 }}
            role="tablist"
            aria-label="Trading mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tradingMode === "day"}
              className="min-h-9 rounded-md px-2.5 text-xs font-semibold transition-colors"
              onClick={() => onTradingModeChange("day")}
              style={{
                background: tradingMode === "day" ? "rgba(0,200,220,0.25)" : "transparent",
                color: tradingMode === "day" ? "#00C8DC" : colors.textMuted,
                border: tradingMode === "day" ? "1px solid rgba(0,200,220,0.45)" : "1px solid transparent"
              }}
            >
              <span className="inline-flex items-center justify-center gap-1">
                <Zap size={14} aria-hidden />
                {TAB_LABEL_DAY}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tradingMode === "swing"}
              className="min-h-9 rounded-md px-2.5 text-xs font-semibold transition-colors"
              onClick={() => onTradingModeChange("swing")}
              style={{
                background: tradingMode === "swing" ? "rgba(168,85,247,0.22)" : "transparent",
                color: tradingMode === "swing" ? "#A855F7" : colors.textMuted,
                border: tradingMode === "swing" ? "1px solid rgba(168,85,247,0.45)" : "1px solid transparent"
              }}
            >
              {TAB_LABEL_SWING}
            </button>
          </div>
        ) : (
          <span
            className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-3 text-xs font-semibold"
            style={{
              border: "1px solid rgba(168,85,247,0.45)",
              background: "rgba(168,85,247,0.15)",
              color: "#A855F7"
            }}
          >
            {TAB_LABEL_SWING} (your plan)
          </span>
        )}
        </div>
      </div>
      <p className="m-0 mt-3 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
        <strong style={{ color: colors.text, fontWeight: 600 }}>
          Mode: {tradingMode === "day" ? TAB_LABEL_DAY : TAB_LABEL_SWING}
        </strong>
        {" · "}
        {tradingMode === "day" ? SUBHEADING_DAY_CADENCE : SUBHEADING_SWING_CADENCE}
        <br />
        {tradingMode === "day"
          ? "Evaluated on live session structure · valid through regular session close."
          : "Evaluated on daily close · horizon ~5 calendar days."}
        <br />
        {WATCHLIST_EVALUATION_HEADER}
        <br />
        {SIGNALS_UPDATE_MICROCOPY}
      </p>
    </article>
  );
}
