"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { AlignmentDrilldownLinks } from "@/components/signals/alignment-drilldown-links";
import {
  buildWhyNotBullets,
  executionDetailToggleLabel,
  executionHeadline,
  executionProgressHint,
  executionReadinessLabel,
  formatSignalsAlignmentDisplayLine,
  primaryExecutionBlockerLine,
  resolveSignalsLayerAlignment,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import type { FundamentalBackdropSummary } from "@/lib/signal-evidence/fundamental-present";
import { SignalsFundamentalBackdrop } from "@/components/signals/signals-fundamental-backdrop";
import { SignalsFundamentalBackdropUpgrade } from "@/components/signals/signals-fundamental-upgrade";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
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
  alignmentRatio?: number | null;
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
  alignmentRatio,
  fundamentalSummary,
  showFundamentalUpgrade = false
}: Props) {
  const { colors } = useTheme();
  const symU = symbol.trim().toUpperCase();
  const [executionDetailOpen, setExecutionDetailOpen] = useState(false);
  const alignment = resolveSignalsLayerAlignment({ rows, bias, alignmentRatio });
  const alignmentLine = formatSignalsAlignmentDisplayLine(alignment, bias, maturationState);
  const biasColor =
    bias === "Bullish" ? colors.bullish : bias === "Bearish" ? colors.bearish : colors.caution;
  const whyNot =
    decision.state === "actionable" ? [] : buildWhyNotBullets(decision, previewLayers, bias, 3);
  const executionHint = executionProgressHint(decision.state, alignment.aligned, alignment.total, bias);
  const executionToggleLabel = executionDetailToggleLabel(decision.state, executionHint);
  const primaryBlocker = primaryExecutionBlockerLine(decision);
  const showExecutionDisclosure =
    decision.state !== "actionable" && Boolean(executionToggleLabel && (primaryBlocker || whyNot.length > 0));

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
          {showExecutionDisclosure && executionToggleLabel ? (
            <div className="mt-1">
              <button
                type="button"
                className="inline-flex w-full items-start gap-1 border-0 bg-transparent p-0 text-left text-xs leading-relaxed underline-offset-2 hover:underline"
                style={{ color: colors.accent, cursor: "pointer" }}
                data-testid="signals-setup-execution-detail-toggle"
                aria-expanded={executionDetailOpen}
                onClick={() => setExecutionDetailOpen((open) => !open)}
              >
                <ChevronDown
                  size={14}
                  className="mt-0.5 shrink-0 transition-transform"
                  style={{
                    transform: executionDetailOpen ? "rotate(180deg)" : "rotate(0deg)"
                  }}
                  aria-hidden
                />
                <span>{executionToggleLabel}</span>
              </button>
              {executionDetailOpen ? (
                <div
                  className="mt-2 text-xs leading-relaxed"
                  style={{
                    color: colors.text,
                    paddingLeft: spacing[2],
                    borderLeft: `2px solid ${colors.accent}`
                  }}
                  data-testid="signals-setup-execution-detail"
                >
                  {primaryBlocker ? <p className="m-0">{primaryBlocker}</p> : null}
                  {whyNot.length > 0 && primaryBlocker !== whyNot[0] ? (
                    <ul className={`m-0 list-none space-y-1 p-0 ${primaryBlocker ? "mt-2" : ""}`}>
                      {whyNot.map((bullet) => (
                        <li key={bullet.slice(0, 48)}>{bullet}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : executionHint ? (
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

      {onOpenEvidence ? (
        <div className="mt-4" data-testid="signals-setup-actions">
          <button
            type="button"
            onClick={onOpenEvidence}
            data-testid="signals-open-evidence-button"
            className="inline-flex w-full items-center justify-center rounded-lg border font-semibold sm:w-auto"
            style={{
              padding: `${spacing[3]} ${spacing[5]}`,
              borderColor: colors.accent,
              background: `color-mix(in srgb, ${colors.accent} 18%, ${colors.surfaceMuted})`,
              color: colors.text,
              fontSize: typography.scale.base,
              cursor: "pointer"
            }}
          >
            Open full evidence
          </button>
          <p className="m-0 mt-1.5 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
            Layer detail, reference context, and gap intelligence for {symU}
          </p>
        </div>
      ) : null}

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
