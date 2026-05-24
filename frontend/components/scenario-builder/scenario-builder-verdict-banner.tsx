"use client";

import type { ScenarioVerdict, ScenarioVerdictTone } from "@/lib/scenario/scenario-verdict";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const VERDICT_VISUAL: Record<
  ScenarioVerdictTone,
  { border: string; background: string; headline: string; glow: string }
> = {
  red: {
    border: "rgba(248, 113, 113, 0.85)",
    background: "linear-gradient(135deg, rgba(127, 29, 29, 0.55) 0%, rgba(69, 10, 10, 0.72) 100%)",
    headline: "#fecaca",
    glow: "0 0 24px rgba(239, 68, 68, 0.35)"
  },
  green: {
    border: "rgba(74, 222, 128, 0.85)",
    background: "linear-gradient(135deg, rgba(20, 83, 45, 0.55) 0%, rgba(6, 46, 22, 0.72) 100%)",
    headline: "#bbf7d0",
    glow: "0 0 24px rgba(34, 197, 94, 0.35)"
  },
  amber: {
    border: "rgba(251, 191, 36, 0.75)",
    background: "linear-gradient(135deg, rgba(120, 53, 15, 0.45) 0%, rgba(69, 26, 3, 0.65) 100%)",
    headline: "#fde68a",
    glow: "0 0 20px rgba(245, 158, 11, 0.25)"
  }
};

export function ScenarioBuilderVerdictBanner({ verdict }: { verdict: ScenarioVerdict }) {
  const { colors } = useTheme();
  const visual = VERDICT_VISUAL[verdict.tone];

  return (
    <div
      data-testid="scenario-verdict-banner"
      data-tone={verdict.tone}
      role="status"
      style={{
        marginBottom: spacing[4],
        padding: `${spacing[3]} ${spacing[4]}`,
        borderRadius: borderRadius.md,
        border: `2px solid ${visual.border}`,
        background: visual.background,
        boxShadow: visual.glow
      }}
    >
      <p
        className={`m-0 font-bold ${verdict.tone === "red" ? "uppercase tracking-wide" : ""}`}
        style={{
          color: visual.headline,
          fontSize: verdict.tone === "green" ? typography.scale.base : typography.scale.sm,
          letterSpacing: verdict.tone === "red" ? "0.04em" : undefined
        }}
        data-testid="scenario-verdict-headline"
      >
        {verdict.headline}
      </p>
      <p className="m-0 mt-2 text-sm leading-relaxed" style={{ color: colors.text }}>
        {verdict.detail}
      </p>
      {verdict.blockers.length > 0 ? (
        <ul className="m-0 mt-2 list-none space-y-1 p-0" data-testid="scenario-verdict-blockers">
          {verdict.blockers.map((line) => (
            <li key={line.slice(0, 64)} className="text-xs leading-relaxed" style={{ color: colors.textMuted }}>
              · {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
