"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import {
  buildExecutionUnlockSteps,
  buildLayerInsightLine,
  buildWhyNotBullets,
  executionDetailToggleLabel,
  executionDisplayTone,
  executionHeadline,
  executionReadinessLabel,
  executionSupportingGates,
  formatSignalsAlignmentDisplayLine,
  groupLayersByForce,
  primaryExecutionBlockerLine,
  primaryGateDisplayText,
  resolveSignalsLayerAlignment,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import { buildExecutionHeaderHint } from "@/lib/signals-desk-kpi-present";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import type { FundamentalBackdropSummary } from "@/lib/signal-evidence/fundamental-present";
import { SIGNALS_SECTION_TARGET } from "@/lib/signals-page-sections";
import { SignalsFundamentalBackdrop } from "@/components/signals/signals-fundamental-backdrop";
import { SignalsFundamentalBackdropUpgrade } from "@/components/signals/signals-fundamental-upgrade";
import { ConvictionTierBadge } from "@/components/signals/conviction-tier-badge";
import { SetupJudgmentSummary } from "@/components/signals/setup-judgment-summary";
import type { SetupJudgment } from "@/lib/signal-evidence/setup-judgment";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  symbol: string;
  tradingMode: "day" | "swing";
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  decision: TradeDecision;
  previewLayers: SignalsLayerRowInput[];
  maturationState?: string | null;
  alignmentRatio?: number | null;
  fundamentalSummary?: FundamentalBackdropSummary | null;
  showFundamentalUpgrade?: boolean;
  /** Desk tabs: KPIs live in sticky strip; omit grid + why-not panel here. */
  layout?: "full" | "desk";
  setupJudgment?: SetupJudgment | null;
  /** Regular session open (Polygon `market` === open). Omit when unknown. */
  regularSessionOpen?: boolean | null;
  riskReward?: number | null;
  minRiskReward?: number | null;
};

export function SignalsSetupRead({
  symbol,
  tradingMode,
  bias,
  rows,
  decision,
  previewLayers,
  maturationState,
  alignmentRatio,
  fundamentalSummary,
  showFundamentalUpgrade = false,
  layout = "full",
  setupJudgment = null,
  regularSessionOpen = null,
  riskReward = null,
  minRiskReward = null
}: Props) {
  const { colors } = useTheme();
  const [executionDetailOpen, setExecutionDetailOpen] = useState(false);
  const alignment = resolveSignalsLayerAlignment({ rows, bias, alignmentRatio });
  const alignmentLine = formatSignalsAlignmentDisplayLine(alignment, bias, maturationState);
  const biasColor =
    bias === "Bullish" ? colors.bullish : bias === "Bearish" ? colors.bearish : colors.caution;
  const whyNot =
    decision.state === "actionable" ? [] : buildWhyNotBullets(decision, previewLayers, bias, 3);
  const executionHint = buildExecutionHeaderHint(
    decision,
    tradingMode,
    alignment.aligned,
    alignment.total,
    bias,
    regularSessionOpen,
    setupJudgment
  );
  const executionToggleLabel = executionDetailToggleLabel(decision.state, executionHint);
  const executionOpts = { tradingMode, regularSessionOpen };
  const executionTone = executionDisplayTone(decision.state, executionOpts);
  const primaryBlocker = primaryExecutionBlockerLine(decision);
  const primaryGate = primaryGateDisplayText(decision);
  const supportingGates = executionSupportingGates(decision);
  const groupedPreview = groupLayersByForce(previewLayers, bias);
  const workingLines = groupedPreview.withBias
    .slice(0, 2)
    .map((row) => `${row.name}: ${buildLayerInsightLine(row, bias)}`);
  const layerBlockingLines = groupedPreview.againstOrMixed
    .slice(0, 2)
    .map((row) => `${row.name}: ${buildLayerInsightLine(row, bias)}`);
  const blockingLines = [...(primaryGate ? [primaryGate] : []), ...supportingGates, ...layerBlockingLines]
    .filter((line, idx, arr) => Boolean(line.trim()) && arr.indexOf(line) === idx)
    .slice(0, 3);
  const unlockLines = buildExecutionUnlockSteps(decision, previewLayers, bias, 2)
    .map((line) => {
      const cleaned = line.trim().replace(/\.$/, "");
      if (!cleaned) return "";
      if (/^need\b/i.test(cleaned)) return `${cleaned}.`;
      return `Need to clear: ${cleaned}.`;
    })
    .filter((line, idx, arr) => Boolean(line.trim()) && arr.indexOf(line) === idx)
    .slice(0, 2);
  const showExecutionDisclosure =
    decision.state !== "actionable" && Boolean(executionToggleLabel && (primaryBlocker || whyNot.length > 0));
  return (
    <article
      id="signals-section-setup"
      className={`signals-snap-section ${surfaceGlowClassName}`}
      data-testid="signals-setup-read"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      {setupJudgment ? (
        <SetupJudgmentSummary
          judgment={setupJudgment}
          mode={tradingMode === "day" ? "day" : "swing"}
          executionLabel={executionReadinessLabel(decision.state, {
            tradingMode,
            regularSessionOpen,
            entryTimingWeak: setupJudgment.tradeability.band === "weak"
          })}
          executionTone={executionTone}
          riskReward={riskReward}
          minRiskReward={minRiskReward}
        />
      ) : null}

      {layout === "full" ? (
        <>
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
              <p
                className="m-0 mt-0.5 text-xl font-semibold"
                style={{ color: biasColor }}
                data-testid="signals-setup-bias"
              >
                {bias}
              </p>
            </div>
            <div>
              <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
                Alignment
              </p>
              <p
                className="m-0 mt-0.5 text-xl font-semibold"
                style={{ color: colors.text }}
                data-testid="signals-setup-alignment"
              >
                {alignmentLine}
              </p>
            </div>
            <div>
              <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
                Execution
              </p>
              <p
                className="m-0 mt-0.5 text-xl font-semibold"
                style={{
                  color:
                    executionTone === "bullish"
                      ? colors.bullish
                      : executionTone === "bearish"
                        ? colors.bearish
                        : executionTone === "caution"
                          ? colors.caution
                          : colors.textMuted
                }}
                data-testid="signals-setup-execution"
              >
                {executionReadinessLabel(decision.state, executionOpts)}
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
        </>
      ) : (
        <p
          className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: colors.textMuted }}
        >
          Setup & scenario
        </p>
      )}

      <div
        id={SIGNALS_SECTION_TARGET.executionDetail}
        className="scroll-mt-4"
        data-testid="signals-section-execution-detail"
      >
      <p
        className="m-0 mt-3 text-sm font-medium leading-snug"
        style={{
          color:
            executionTone === "bullish"
              ? colors.bullish
              : executionTone === "caution"
                ? colors.caution
                : colors.textMuted
        }}
        data-testid="signals-setup-actionable"
      >
        {executionHeadline(decision.state, executionOpts)}
      </p>
      <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
        {decision.line}
      </p>

      {decision.conviction ? <ConvictionTierBadge conviction={decision.conviction} /> : null}
      </div>

      {fundamentalSummary ? <SignalsFundamentalBackdrop summary={fundamentalSummary} /> : null}
      {showFundamentalUpgrade ? <SignalsFundamentalBackdropUpgrade /> : null}

      {layout === "full" && whyNot.length > 0 ? (
        <div className="mt-4" data-testid="signals-why-not">
          <p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            Why we are skipping this setup right now
          </p>
          <div className="mt-2 grid gap-2">
            <section
              data-testid="signals-why-not-working"
              className="rounded-lg p-2"
              style={{ border: `1px solid ${colors.border}`, background: colors.surfaceMuted }}
            >
              <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.bullish }}>
                What is working
              </p>
              <ul className="m-0 mt-1 list-none space-y-1 p-0">
                {(workingLines.length > 0 ? workingLines : ["No strong supportive check yet."]).map((line) => (
                  <li key={line.slice(0, 48)} className="text-sm leading-snug" style={{ color: colors.text }}>
                    {line}
                  </li>
                ))}
              </ul>
            </section>
            <section
              data-testid="signals-why-not-blocking"
              className="rounded-lg p-2"
              style={{ border: `1px solid ${colors.border}`, background: colors.surfaceMuted }}
            >
              <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.bearish }}>
                What is blocking
              </p>
              <ul className="m-0 mt-1 list-none space-y-1 p-0">
                {(blockingLines.length > 0 ? blockingLines : whyNot.slice(0, 2)).map((line) => (
                  <li key={line.slice(0, 48)} className="text-sm leading-snug" style={{ color: colors.text }}>
                    {line}
                  </li>
                ))}
              </ul>
            </section>
            <section
              data-testid="signals-why-not-unlock"
              className="rounded-lg p-2"
              style={{ border: `1px solid ${colors.border}`, background: colors.surfaceMuted }}
            >
              <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.accent }}>
                What must change
              </p>
              <ul className="m-0 mt-1 list-none space-y-1 p-0">
                {(unlockLines.length > 0
                  ? unlockLines
                  : ["Need more confirmation from technical and risk checks before this can be considered."]
                ).map((line) => (
                  <li key={line.slice(0, 48)} className="text-sm leading-snug" style={{ color: colors.text }}>
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          </div>
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
