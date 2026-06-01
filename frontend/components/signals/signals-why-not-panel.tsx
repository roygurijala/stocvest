"use client";

import { Check, Circle } from "lucide-react";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import {
  causalBulletsForWhyNot,
  resolveCausalNarrative,
  type CausalNarrative
} from "@/lib/signal-evidence/causal-narrative";
import {
  buildExecutionUnlockSteps,
  buildLayerInsightLine,
  buildWhyNotBullets,
  decisionGateCategoryLabel,
  executionReadinessLabel,
  executionSupportingGates,
  groupLayersByForce,
  primaryGateDisplayText,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import { SIGNALS_SECTION_TARGET } from "@/lib/signals-page-sections";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  decision: TradeDecision;
  previewLayers: SignalsLayerRowInput[];
  bias: SignalsSetupBias;
  maxBullets?: number;
  /** All layer rows for causal narrative (defaults to previewLayers). */
  allLayers?: SignalsLayerRowInput[];
  signalSummary?: string;
  causalNarrativeApi?: unknown;
  /** When causal narrative renders on this tab, skip duplicate layer preview bullets. */
  causalNarrativeOnPage?: boolean;
};

function plainEnglishUnlockLine(line: string): string {
  const cleaned = line.trim().replace(/\.$/, "");
  if (!cleaned) return "";
  if (/^need\b/i.test(cleaned)) return `${cleaned}.`;
  if (/^not enough\b/i.test(cleaned)) return `Need clearer confirmation: ${cleaned}.`;
  if (/^risk\/?reward/i.test(cleaned)) return `Need better risk/reward: ${cleaned}.`;
  return `Need to clear: ${cleaned}.`;
}

export function SignalsWhyNotPanel({
  decision,
  previewLayers,
  bias,
  maxBullets = 5,
  allLayers,
  signalSummary = "",
  causalNarrativeApi,
  causalNarrativeOnPage = false
}: Props) {
  const { colors } = useTheme();
  if (decision.state === "actionable") return null;

  const narrative: CausalNarrative | null = resolveCausalNarrative({
    apiPayload: causalNarrativeApi,
    signalSummary: signalSummary || bias.toLowerCase(),
    rows: allLayers ?? previewLayers,
    executionNote: decision.rationale?.text ?? null
  });
  const causalFallback =
    !causalNarrativeOnPage && narrative ? causalBulletsForWhyNot(narrative, maxBullets) : null;
  const primaryGateText = primaryGateDisplayText(decision);
  const supportingGates = executionSupportingGates(decision);
  const skipGateBulletFallback =
    Boolean(primaryGateText) && decision.rationale?.category === "risk_reward";
  const layerPreviewBullets =
    causalFallback ??
    (skipGateBulletFallback
      ? []
      : buildWhyNotBullets(
          decision,
          previewLayers,
          bias,
          maxBullets,
          null,
          causalNarrativeOnPage
        ).filter((bullet) => {
          if (primaryGateText && (bullet === primaryGateText || bullet.includes(primaryGateText))) {
            return false;
          }
          return !supportingGates.some((g) => bullet === g || bullet.includes(g));
        }));

  const hasPrimaryGate = Boolean(decision.rationale?.text);
  if (!hasPrimaryGate && supportingGates.length === 0 && layerPreviewBullets.length === 0) {
    return null;
  }

  const readinessLabel = executionReadinessLabel(decision.state);
  const readinessColor = colors.bearish;
  const layerSource = (allLayers && allLayers.length > 0 ? allLayers : previewLayers) ?? [];
  const grouped = groupLayersByForce(layerSource, bias);
  const workingLines = grouped.withBias
    .slice(0, 3)
    .map((row) => `${row.name}: ${buildLayerInsightLine(row, bias)}`);
  const blockingLayerLines = grouped.againstOrMixed
    .slice(0, 3)
    .map((row) => `${row.name}: ${buildLayerInsightLine(row, bias)}`);
  const gateBlockingLines = [
    ...(primaryGateText ? [primaryGateText] : []),
    ...supportingGates
  ].slice(0, 3);
  const blockingLines = [...gateBlockingLines, ...blockingLayerLines]
    .filter((line, idx, arr) => Boolean(line.trim()) && arr.indexOf(line) === idx)
    .slice(0, 4);
  const unlockLines = buildExecutionUnlockSteps(decision, layerSource, bias, 3)
    .map(plainEnglishUnlockLine)
    .filter((line, idx, arr) => Boolean(line.trim()) && arr.indexOf(line) === idx);

  return (
    <article
      id={SIGNALS_SECTION_TARGET.whyNotActionable}
      className={`scroll-mt-4 ${surfaceGlowClassName}`}
      data-testid="signals-why-not"
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
        Execution
      </p>
      <p
        className="m-0 mt-1 text-xl font-semibold leading-tight"
        style={{ color: readinessColor }}
        data-testid="signals-why-not-headline"
      >
        {readinessLabel}
      </p>
      <p className="m-0 mt-1 text-xs leading-snug" style={{ color: colors.textMuted }}>
        {causalNarrativeOnPage
          ? "Plain-English breakdown is below. Full layer story remains in “Why layers read this way”."
          : "Plain-English breakdown of what is helping, what is blocking, and what must change next."}
      </p>

      {hasPrimaryGate && decision.rationale ? (
        <div
          className="mt-4 rounded-lg p-3"
          style={{
            background: colors.surfaceMuted,
            border: `1px solid ${colors.border}`
          }}
          data-testid="signals-why-not-primary-gate"
        >
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.caution }}>
            Main check · {decisionGateCategoryLabel(decision.rationale.category)}
          </p>
          <p className="m-0 mt-2 text-sm font-medium leading-snug" style={{ color: colors.text }}>
            {primaryGateText ?? decision.rationale.text}
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3" data-testid="signals-why-not-plain-english">
        <section
          className="rounded-lg p-3"
          style={{ background: colors.surfaceMuted, border: `1px solid ${colors.border}` }}
          data-testid="signals-why-not-working"
        >
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.bullish }}>
            What is working
          </p>
          <ul className="m-0 mt-2 list-none space-y-2 p-0">
            {(workingLines.length > 0 ? workingLines : ["No strong supportive signal yet."]).map((line) => (
              <li key={line.slice(0, 64)} className="flex items-start gap-2.5 text-sm leading-snug">
                <Check size={16} className="mt-0.5 shrink-0" style={{ color: colors.bullish }} aria-hidden />
                <span style={{ color: colors.text }}>{line}</span>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="rounded-lg p-3"
          style={{ background: colors.surfaceMuted, border: `1px solid ${colors.border}` }}
          data-testid="signals-why-not-blocking"
        >
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.bearish }}>
            What is blocking this trade
          </p>
          <ul className="m-0 mt-2 list-none space-y-2 p-0">
            {(blockingLines.length > 0
              ? blockingLines
              : ["The setup still lacks enough confirmation to clear execution checks."]
            ).map((line) => (
              <li key={line.slice(0, 64)} className="flex items-start gap-2.5 text-sm leading-snug">
                <Circle size={16} className="mt-0.5 shrink-0" style={{ color: colors.caution }} aria-hidden />
                <span style={{ color: colors.text }}>{line}</span>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="rounded-lg p-3"
          style={{ background: colors.surfaceMuted, border: `1px solid ${colors.border}` }}
          data-testid="signals-why-not-unlock"
        >
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.accent }}>
            What must change before we can consider a trade
          </p>
          <ul className="m-0 mt-2 list-none space-y-2 p-0">
            {(unlockLines.length > 0
              ? unlockLines
              : ["Need more agreement from technical and risk checks before execution is considered."]
            ).map((line) => (
              <li key={line.slice(0, 64)} className="flex items-start gap-2.5 text-sm leading-snug">
                <Circle size={16} className="mt-0.5 shrink-0" style={{ color: colors.accent }} aria-hidden />
                <span style={{ color: colors.text }}>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {supportingGates.length > 0 ? (
        <div className="mt-4" data-testid="signals-why-not-supporting-gates">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            Also in play
          </p>
          <ul className="m-0 mt-2 list-none space-y-2 p-0">
            {supportingGates.map((line) => (
              <li key={line.slice(0, 48)} className="flex items-start gap-2.5 text-sm leading-snug">
                <Circle size={16} className="mt-0.5 shrink-0" style={{ color: colors.caution }} aria-hidden />
                <span style={{ color: colors.text }}>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {layerPreviewBullets.length > 0 ? (
        <div className="mt-4" data-testid="signals-why-not-layer-preview">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            {causalNarrativeOnPage ? "Additional context" : "Layer preview"}
          </p>
          <ul className="m-0 mt-2 list-none space-y-2.5 p-0">
            {layerPreviewBullets.map((bullet, index) => (
              <li key={bullet.slice(0, 48)} className="flex items-start gap-2.5 text-sm leading-snug">
                {index === 0 && !hasPrimaryGate && supportingGates.length === 0 ? (
                  <Circle
                    size={16}
                    className="mt-0.5 shrink-0"
                    style={{ color: colors.caution }}
                    aria-hidden
                  />
                ) : (
                  <Check
                    size={16}
                    className="mt-0.5 shrink-0 opacity-40"
                    style={{ color: colors.textMuted }}
                    aria-hidden
                  />
                )}
                <span style={{ color: colors.text }}>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
