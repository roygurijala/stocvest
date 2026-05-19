"use client";

import Link from "next/link";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { AlignmentDrilldownLinks } from "@/components/signals/alignment-drilldown-links";
import { signalsAlignmentDisplayLine } from "@/lib/nav/alignment-display-line";
import {
  buildWhyNotBullets,
  countLayerAlignment,
  executionHeadline,
  executionProgressHint,
  executionReadinessLabel,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import type { FundamentalBackdropSummary } from "@/lib/signal-evidence/fundamental-present";
import { SignalsFundamentalBackdrop } from "@/components/signals/signals-fundamental-backdrop";
import { SignalsFundamentalBackdropUpgrade } from "@/components/signals/signals-fundamental-upgrade";
import { watchlistToSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  symbol: string;
  tradingMode: "day" | "swing";
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  decision: TradeDecision;
  previewLayers: SignalsLayerRowInput[];
  onOpenEvidence?: () => void;
  onSwitchToHistory?: () => void;
  maturationState?: string | null;
  fundamentalSummary?: FundamentalBackdropSummary | null;
  showFundamentalUpgrade?: boolean;
};

export function SignalsSetupRead({
  symbol,
  tradingMode,
  bias,
  rows,
  decision,
  previewLayers,
  onOpenEvidence,
  onSwitchToHistory,
  maturationState,
  fundamentalSummary,
  showFundamentalUpgrade = false
}: Props) {
  const { colors } = useTheme();
  const symU = symbol.trim().toUpperCase();
  const alignment = countLayerAlignment(rows, bias);
  const alignmentLine = signalsAlignmentDisplayLine({
    layersAligned: alignment.aligned,
    layersTotal: alignment.total,
    maturationState
  });
  const biasColor =
    bias === "Bullish" ? colors.bullish : bias === "Bearish" ? colors.bearish : colors.caution;
  const whyNot =
    decision.state === "actionable" ? [] : buildWhyNotBullets(decision, previewLayers, bias, 3);
  const executionHint = executionProgressHint(decision.state, alignment.aligned, alignment.total);

  return (
    <article
      className={surfaceGlowClassName}
      data-testid="signals-setup-read"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      <p
        className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: colors.textMuted }}
      >
        Setup read
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
            Bias
          </p>
          <p className="m-0 mt-0.5 text-xl font-semibold" style={{ color: biasColor }} data-testid="signals-setup-bias">
            {bias}
          </p>
        </div>
        <div>
          <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
            Alignment
          </p>
          {onOpenEvidence ? (
            <button
              type="button"
              className="m-0 mt-0.5 border-0 bg-transparent p-0 text-left text-xl font-semibold underline-offset-2 hover:underline"
              style={{ color: colors.text, cursor: "pointer" }}
              data-testid="signals-setup-alignment"
              onClick={onOpenEvidence}
              title="Open layer evidence"
            >
              {alignmentLine}
            </button>
          ) : (
            <p
              className="m-0 mt-0.5 text-xl font-semibold"
              style={{ color: colors.text }}
              data-testid="signals-setup-alignment"
            >
              {alignmentLine}
            </p>
          )}
          <div className="mt-1.5">
            <AlignmentDrilldownLinks
              symbol={symU}
              mode={tradingMode}
              onOpenEvidence={onOpenEvidence}
              onScrollToEvolution={onSwitchToHistory}
              samePageLayers
              testId="signals-setup-alignment-links"
            />
          </div>
        </div>
        <div>
          <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
            Execution
          </p>
          <p
            className="m-0 mt-0.5 text-xl font-semibold"
            style={{ color: decision.state === "actionable" ? colors.bullish : colors.textMuted }}
            data-testid="signals-setup-execution"
          >
            {executionReadinessLabel(decision.state)}
          </p>
          {executionHint ? (
            <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
              {executionHint}
            </p>
          ) : null}
        </div>
      </div>

      <p
        className="m-0 mt-3 text-sm font-medium leading-snug"
        style={{ color: decision.state === "actionable" ? colors.bullish : colors.textMuted }}
        data-testid="signals-setup-actionable"
      >
        {executionHeadline(decision.state)}
      </p>
      <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
        {decision.line}
      </p>

      {fundamentalSummary ? <SignalsFundamentalBackdrop summary={fundamentalSummary} /> : null}
      {showFundamentalUpgrade ? <SignalsFundamentalBackdropUpgrade /> : null}

      {whyNot.length > 0 ? (
        <div className="mt-4" data-testid="signals-why-not">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            Why not?
          </p>
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {whyNot.map((bullet) => (
              <li
                key={bullet.slice(0, 48)}
                className="text-sm leading-snug"
                style={{ color: colors.text, paddingLeft: spacing[2], borderLeft: `2px solid ${colors.border}` }}
              >
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4" data-testid="signals-next">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
          Next
        </p>
        <ul className="m-0 mt-2 list-none space-y-1 p-0 text-sm">
          <li>
            <Link
              href="/dashboard/watchlists"
              className="font-medium no-underline hover:underline"
              style={{ color: colors.accent }}
            >
              Review on Watchlist
            </Link>
            <span style={{ color: colors.textMuted }}> — track {symU} across desks</span>
          </li>
          <li>
            <Link
              href={watchlistToSignalsHref(symU, tradingMode)}
              className="font-medium no-underline hover:underline"
              style={{ color: colors.accent }}
            >
              Monitor progression
            </Link>
            <span style={{ color: colors.textMuted }}> — maturation for this mode</span>
          </li>
          <li>
            <button
              type="button"
              className="border-0 bg-transparent p-0 text-left font-medium underline-offset-2 hover:underline"
              style={{ color: colors.accent, cursor: "pointer" }}
              onClick={onSwitchToHistory}
            >
              View setup evolution
            </button>
            <span style={{ color: colors.textMuted }}> — past maturation states for this symbol</span>
          </li>
          {onOpenEvidence ? (
            <li>
              <button
                type="button"
                className="border-0 bg-transparent p-0 text-left font-medium underline-offset-2 hover:underline"
                style={{ color: colors.accent, cursor: "pointer" }}
                onClick={onOpenEvidence}
              >
                Open full evidence
              </button>
              <span style={{ color: colors.textMuted }}> — layer detail + reference context</span>
            </li>
          ) : null}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs" style={{ color: colors.textMuted }}>
          <InfoTip
            label="Informational only"
            text="This page validates setup state from STOCVEST signal data. It is not investment advice and does not instruct a trade. You are solely responsible for trading decisions."
            maxWidth={320}
          />
          Informational only
        </span>
        <SignalDisclaimerChip />
      </div>
    </article>
  );
}
