"use client";

import Link from "next/link";
import { Layers } from "lucide-react";
import { DeskModeTabNav } from "@/components/desk-mode-tab-nav";
import type { ReactNode } from "react";
import { InfoTip } from "@/components/info-tip";
import { setupEvolutionHubHref } from "@/lib/nav/setup-analytics-deeplink";
import { TAB_LABEL_DAY, TAB_LABEL_SWING } from "@/lib/mode-terminology";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { WatchlistMaturationLine } from "@/lib/hooks/use-watchlist-maturation-line";
import {
  formatSignalsModeEvaluatedSegment,
  signalsDeskModeTooltip,
  type SignalEvaluationFreshness
} from "@/lib/signals-evaluation-present";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";
import type { SignalsDeskVerdictBundle } from "@/lib/signals-desk-kpi-present";
import type { SignalsDeskTab, SignalsKpiTarget } from "@/lib/signals-page-tabs";
import { SignalsDeskVerdictRow } from "@/components/signals/signals-desk-verdict-row";
import type { SignalsDeskPriceContext } from "@/lib/signals-desk-price-present";
import type { SignalsDirectionChip } from "@/lib/signals-page-present";
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
  /** Inline bias / alignment / execution verdict (replaces separate KPI strip). */
  deskVerdict?: SignalsDeskVerdictBundle | null;
  /** Long / Short / No edge — matches watchlist card chips. */
  directionChip?: SignalsDirectionChip | null;
  activeDeskTab?: SignalsDeskTab;
  decisionState?: TradeDecisionState | null;
  onDeskKpiTarget?: (target: SignalsKpiTarget) => void;
};

function signalsDeskActionButtonStyle(colors: {
  text: string;
  surfaceMuted: string;
  accent: string;
}) {
  return {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: spacing[2],
    padding: `${spacing[2]} ${spacing[3]}`,
    fontSize: typography.scale.xs,
    fontWeight: 700,
    color: colors.text,
    background: colors.surfaceMuted,
    border: `1px solid ${colors.accent}`,
    borderRadius: borderRadius.md,
    cursor: "pointer" as const,
    whiteSpace: "nowrap" as const
  };
}

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
  priceContext = null,
  deskVerdict = null,
  directionChip = null,
  activeDeskTab = "setup",
  decisionState = null,
  onDeskKpiTarget
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

  const deskActionButtonStyle = signalsDeskActionButtonStyle(colors);

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
            {directionChip ? (
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold leading-none"
                data-testid="signals-command-bar-direction-chip"
                style={{
                  color: directionChip.color,
                  background: directionChip.background
                }}
              >
                {directionChip.label}
              </span>
            ) : null}
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
          <div
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2"
            data-testid="signals-desk-actions"
          >
            {watchlistControl}
            {scenarioControl}
            {onOpenEvidence ? (
              <button
                type="button"
                data-testid="signals-open-evidence-button"
                title="Inspect the full layer stack and trade rationale for this symbol."
                style={deskActionButtonStyle}
                onClick={onOpenEvidence}
              >
                <Layers size={13} aria-hidden="true" />
                <span>Open full evidence</span>
              </button>
            ) : null}
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
        <div
          className="flex w-full min-w-0 flex-col gap-2 lg:w-auto lg:shrink-0 lg:flex-row lg:items-center lg:justify-end"
          data-testid="signals-desk-mode-controls"
        >
          {dayTradingSurfaces ? (
            <DeskModeTabNav
              value={tradingMode}
              onChange={onTradingModeChange}
              modes={["day", "swing"] as const}
              ariaLabel="Trading mode"
              testIdPrefix="signals-trading-mode"
              className="w-full min-w-0 sm:w-auto sm:min-w-[220px]"
            />
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
      {deskVerdict && decisionState && onDeskKpiTarget ? (
        <SignalsDeskVerdictRow
          items={deskVerdict.items}
          activeTab={activeDeskTab}
          biasProof={deskVerdict.biasProof}
          executionHint={deskVerdict.executionHint}
          decisionState={decisionState}
          onSelectTarget={onDeskKpiTarget}
        />
      ) : null}
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
