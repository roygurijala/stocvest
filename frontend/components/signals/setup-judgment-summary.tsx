"use client";

import { useState } from "react";
import type { SetupJudgment } from "@/lib/signal-evidence/setup-judgment";
import { explainBlocker } from "@/lib/signal-evidence/blocker-explainer";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/** Prototype-style segmented pill progress meter (replaces unicode dots). */
function ProgressPillMeter({
  aligned,
  total,
  tier
}: {
  aligned: number;
  total: number;
  tier: string;
}) {
  const { colors } = useTheme();
  const isActionable = tier === "actionable";
  const isInvalidated = tier === "invalidated" || tier === "re_evaluating";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {Array.from({ length: total }, (_, i) => {
          const filled = i < aligned;
          const isNext = !filled && i === aligned && !isInvalidated;
          // Empty pills get a visible "track" fill so the remaining steps read
          // clearly against the dark card (a faint border alone disappeared).
          let bg = "rgba(148,163,184,0.20)";
          let shadow = "none";
          if (filled) {
            if (isInvalidated) {
              bg = "linear-gradient(90deg, #f0726c, #ef4444)";
              shadow = "0 0 7px rgba(239,68,68,.4)";
            } else if (isActionable) {
              bg = "linear-gradient(90deg, #34d77a, #22c55e)";
              shadow = "0 0 8px rgba(34,197,94,.5)";
            } else {
              bg = "linear-gradient(90deg, #fbbf24, #f59e0b)";
              shadow = "0 0 6px rgba(245,158,11,.4)";
            }
          } else if (isNext) {
            // The upcoming step: amber ring + faint amber tint.
            bg = "rgba(245,158,11,0.18)";
            shadow = "inset 0 0 0 1px #f59e0b";
          }
          return (
            <div
              key={i}
              style={{
                width: 20,
                height: 6,
                borderRadius: 999,
                background: bg,
                boxShadow: shadow,
                transition: "background .2s, box-shadow .2s"
              }}
            />
          );
        })}
      </div>
      <span
        style={{
          fontSize: typography.scale.sm,
          fontWeight: 700,
          color: colors.text,
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {aligned}
        <span style={{ color: colors.textMuted, fontWeight: 600 }}>/{total}</span>
      </span>
    </div>
  );
}

type Props = {
  judgment: SetupJudgment;
  /** When set, shown as authoritative execution read (decision state). */
  executionLabel?: string | null;
  executionTone?: "bullish" | "bearish" | "caution" | "muted";
  /** Desk lane — tunes the plain-English blocker phrasing. */
  mode?: "swing" | "day";
  /** Eval-time or structure R/R — shown when entry timing and geometry diverge. */
  riskReward?: number | null;
  minRiskReward?: number | null;
};

/**
 * Renders the trade blocker as a clear, plain-English explanation with the
 * terse technical phrasing available behind a toggle for users who want it.
 */
function BlockerExplainer({ blocker, mode }: { blocker: string; mode: "swing" | "day" }) {
  const { colors } = useTheme();
  const [showTechnical, setShowTechnical] = useState(false);
  const explanation = explainBlocker(blocker, { mode });
  if (!explanation) return null;

  return (
    <div
      data-testid="setup-judgment-blocker"
      style={{
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: "rgba(245,158,11,0.06)",
        borderLeft: `3px solid ${colors.caution}`,
        padding: `${spacing[2]} ${spacing[3]}`
      }}
    >
      <p
        className="m-0 text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: colors.caution }}
      >
        Why this isn&apos;t a trade yet
      </p>
      <div className="mt-1.5 grid gap-1.5">
        {explanation.plain.map((para, i) => (
          <p key={i} className="m-0 text-sm leading-relaxed" style={{ color: colors.text }}>
            {para}
          </p>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setShowTechnical((v) => !v)}
        data-testid="setup-judgment-blocker-toggle"
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium"
        style={{
          color: colors.textMuted,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0
        }}
        aria-expanded={showTechnical}
      >
        <span style={{ transform: showTechnical ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
          ▸
        </span>
        {showTechnical ? "Hide technical detail" : "Show technical detail"}
      </button>
      {showTechnical ? (
        <p
          className="m-0 mt-1.5 text-xs leading-snug"
          style={{
            color: colors.textMuted,
            fontFamily: "var(--font-mono, ui-monospace, monospace)"
          }}
          data-testid="setup-judgment-blocker-technical"
        >
          {explanation.technical}
        </p>
      ) : null}
    </div>
  );
}

function bandColor(band: SetupJudgment["tradeability"]["band"], colors: ReturnType<typeof useTheme>["colors"]) {
  if (band === "strong") return colors.bullish;
  if (band === "weak") return colors.bearish;
  return colors.caution;
}

export function SetupJudgmentSummary({
  judgment,
  executionLabel,
  executionTone,
  mode = "swing",
  riskReward = null,
  minRiskReward = null
}: Props) {
  const { colors } = useTheme();
  const { process, setupPhase, tradeability, primaryBlocker, watchFor } = judgment;

  return (
    <section
      data-testid="setup-judgment-summary"
      className="grid gap-3"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: `color-mix(in srgb, ${colors.surfaceMuted} 88%, ${colors.surface})`,
        padding: spacing[3]
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            Setup progress
          </p>
          <ProgressPillMeter
            aligned={process.layersAligned}
            total={process.layersTotal}
            tier={process.tier}
          />
          <p className="m-0 mt-1.5 text-sm font-medium" style={{ color: colors.accent }} data-testid="setup-judgment-process">
            {process.label}
          </p>
        </div>
        {setupPhase ? (
          <div>
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
              Phase
            </p>
            <p className="m-0 mt-1 text-lg font-semibold" style={{ color: colors.text }} data-testid="setup-judgment-phase">
              {setupPhase.label}
            </p>
            <p className="m-0 mt-0.5 text-xs" style={{ color: colors.textMuted }}>
              Momentum stage — not a trade signal
            </p>
          </div>
        ) : null}
        <div>
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
            Entry timing
          </p>
          <p
            className="m-0 mt-1 text-lg font-semibold"
            style={{ color: bandColor(tradeability.band, colors) }}
            data-testid="setup-judgment-tradeability"
          >
            {tradeability.label}
          </p>
          {executionLabel ? (
            <p
              className="m-0 mt-0.5 text-sm font-medium"
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
              data-testid="setup-judgment-execution"
            >
              Execution: {executionLabel}
            </p>
          ) : null}
          {riskReward != null && tradeability.band !== "strong" ? (
            <p className="m-0 mt-1 text-xs leading-snug" style={{ color: colors.textMuted }} data-testid="setup-judgment-rr-context">
              R/R {riskReward.toFixed(1)}:1 at reference levels
              {minRiskReward != null
                ? riskReward >= minRiskReward
                  ? ` — clears ${minRiskReward.toFixed(1)}:1 desk gate, but entry timing is still ${tradeability.band}`
                  : ` — below ${minRiskReward.toFixed(1)}:1 desk gate`
                : ` — geometry can look fine while entry timing stays ${tradeability.band}`}
              .
            </p>
          ) : null}
        </div>
      </div>

      {primaryBlocker ? <BlockerExplainer blocker={primaryBlocker} mode={mode} /> : null}

      {watchFor ? (
        <p className="m-0 text-sm leading-snug" style={{ color: colors.textMuted }} data-testid="setup-judgment-watch-for">
          <span style={{ fontWeight: 600, color: colors.accent }}>What must change: </span>
          {watchFor}
        </p>
      ) : null}

      {tradeability.flags.length > 0 ? (
        <ul
          className="m-0 flex flex-wrap gap-1.5 p-0 list-none"
          data-testid="setup-judgment-flags"
          style={{ fontSize: typography.scale.xs }}
        >
          {tradeability.flags.map((f) => (
            <li
              key={f.id}
              style={{
                borderRadius: borderRadius.full,
                padding: "2px 8px",
                fontWeight: 600,
                background:
                  f.severity === "block" ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
                color: f.severity === "block" ? colors.bearish : colors.caution,
                border: `1px solid ${f.severity === "block" ? "rgba(239,68,68,0.35)" : "rgba(245,158,11,0.35)"}`
              }}
            >
              {f.label}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
