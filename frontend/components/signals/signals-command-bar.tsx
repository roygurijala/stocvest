"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import type { ReactNode } from "react";
import { InfoTip } from "@/components/info-tip";
import { setupEvolutionHubHref } from "@/lib/nav/setup-analytics-deeplink";
import { TAB_LABEL_DAY, TAB_LABEL_SWING } from "@/lib/mode-terminology";
import { borderRadius, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { WatchlistMaturationLine } from "@/lib/hooks/use-watchlist-maturation-line";
import {
  formatSignalsModeEvaluatedSegment,
  signalsDeskModeTooltip,
  type SignalEvaluationFreshness
} from "@/lib/signals-evaluation-present";
import type { SignalsDeskPriceContext } from "@/lib/signals-desk-price-present";
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
  /** Primary evidence entry — full-width on mobile; inline on desktop. */
  onOpenEvidence?: () => void;
  /** Snapshot-backed last price + session change (context only). */
  priceContext?: SignalsDeskPriceContext | null;
};

const evidenceButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg border px-4 text-sm font-semibold sm:min-h-9 sm:w-auto sm:px-3 sm:text-sm";

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
  onOpenEvidence,
  priceContext = null
}: Props) {
  const { colors } = useTheme();
  const symU = symbol.trim().toUpperCase();
  const maturationEvaluatedAt = maturationLine?.evaluatedAt
    ? formatLastEvaluatedShort(maturationLine.evaluatedAt)
    : null;
  const modeLabel = tradingMode === "day" ? TAB_LABEL_DAY : TAB_LABEL_SWING;
  const evaluatedSegment = formatSignalsModeEvaluatedSegment(evaluationFreshness);
  const freshnessAccent =
    evaluationFreshness?.phase === "refreshing" || evaluationFreshness?.phase === "loading";

  const evidenceButtonStyle = {
    borderColor: colors.accent,
    background: `color-mix(in srgb, ${colors.accent} 16%, ${colors.surfaceMuted})`,
    color: colors.text,
    cursor: "pointer" as const
  };

  return (
    <article
      className={`${surfaceGlowClassName} p-3 sm:p-4`}
      data-testid="signals-command-bar"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2
              className="m-0 text-xl font-semibold tracking-tight sm:text-2xl"
              style={{ color: colors.text, lineHeight: 1.15 }}
            >
              {symU}
            </h2>
            {priceContext ? (
              <span
                className="inline-flex flex-wrap items-baseline gap-x-1.5 text-sm font-medium tabular-nums sm:text-base"
                data-testid="signals-command-bar-price"
                aria-label={priceContext.accessibleLabel}
              >
                <span className="text-xs font-normal" style={{ color: colors.textMuted }}>
                  {priceContext.priceLabel}
                </span>
                <span style={{ color: colors.text }}>{priceContext.priceFormatted}</span>
                {priceContext.dayChangeFormatted ? (
                  <span
                    style={{
                      color:
                        priceContext.dayChangeTone === "up"
                          ? colors.bullish
                          : priceContext.dayChangeTone === "down"
                            ? colors.bearish
                            : colors.textMuted
                    }}
                  >
                    {priceContext.dayChangeFormatted}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
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
              <span
                className="max-w-full text-xs leading-snug"
                style={{ color: colors.textMuted }}
                data-testid="signals-maturation-line"
              >
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
        <div className="flex w-full min-w-0 flex-col gap-2 lg:w-auto lg:shrink-0 lg:flex-row lg:items-center lg:justify-end">
          {onOpenEvidence ? (
            <button
              type="button"
              data-testid="signals-open-evidence-button"
              className={evidenceButtonClass}
              style={evidenceButtonStyle}
              onClick={onOpenEvidence}
            >
              Open full evidence
            </button>
          ) : null}
          {dayTradingSurfaces ? (
            <div
              className="grid w-full min-w-0 grid-cols-2 gap-1 rounded-lg p-1 sm:w-auto sm:min-w-[200px]"
              style={{ border: `1px solid ${colors.border}`, background: colors.background }}
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
              className="inline-flex min-h-9 w-full items-center justify-center rounded-lg px-3 text-xs font-semibold sm:w-auto"
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
      <p
        className="m-0 mt-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs leading-snug"
        data-testid="signals-mode-eval-line"
        style={{ color: colors.textMuted }}
      >
        <span style={{ color: colors.text, fontWeight: 600 }}>Mode: {modeLabel}</span>
        {evaluatedSegment ? (
          <>
            <span aria-hidden>·</span>
            <span
              data-testid="signals-evaluation-freshness"
              style={{ color: freshnessAccent ? "#00C8DC" : colors.textMuted, fontWeight: 500 }}
            >
              {evaluatedSegment}
            </span>
          </>
        ) : null}
        <InfoTip
          text={signalsDeskModeTooltip(tradingMode)}
          label={`About ${modeLabel} desk evaluation`}
          maxWidth={340}
        />
      </p>
    </article>
  );
}
