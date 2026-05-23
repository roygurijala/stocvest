"use client";

import type { ScenarioVerdict } from "@/lib/scenario/scenario-verdict";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

export function ScenarioBuilderVerdictBanner({ verdict }: { verdict: ScenarioVerdict }) {
  const { colors } = useTheme();
  const toneColor =
    verdict.tone === "green" ? colors.bullish : verdict.tone === "amber" ? colors.caution : colors.bearish;
  const bg =
    verdict.tone === "green"
      ? `color-mix(in srgb, ${colors.bullish} 12%, transparent)`
      : verdict.tone === "amber"
        ? `color-mix(in srgb, ${colors.caution} 12%, transparent)`
        : `color-mix(in srgb, ${colors.bearish} 14%, transparent)`;

  return (
    <div
      data-testid="scenario-verdict-banner"
      data-tone={verdict.tone}
      role="status"
      style={{
        marginBottom: spacing[4],
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid color-mix(in srgb, ${toneColor} 45%, ${colors.border})`,
        background: bg
      }}
    >
      <p
        className="m-0 text-sm font-bold"
        style={{ color: toneColor, fontSize: typography.scale.sm }}
        data-testid="scenario-verdict-headline"
      >
        {verdict.headline}
      </p>
      <p className="m-0 mt-1 text-xs leading-relaxed" style={{ color: colors.text }}>
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
