"use client";

import { InfoTip } from "@/components/info-tip";
import type { FundamentalBackdropSummary } from "@/lib/signal-evidence/fundamental-present";
import { backdropToneColor } from "@/lib/signal-evidence/fundamental-present";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  summary: FundamentalBackdropSummary;
};

export function SignalsFundamentalBackdrop({ summary }: Props) {
  const { colors } = useTheme();
  const tone = backdropToneColor(summary.backdrop, colors);

  return (
    <section
      className="mt-4"
      data-testid="signals-fundamental-backdrop"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${tone} 35%, ${colors.border})`,
        background: `color-mix(in srgb, ${tone} 8%, ${colors.surface})`,
        padding: spacing[3]
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 text-sm font-semibold" style={{ color: tone }}>
          {summary.headline}
        </p>
        <InfoTip
          label="Fundamental backdrop"
          text="Slow-moving narrative context (earnings, guidance, revenue). Not a seventh layer — does not change alignment or block the setup."
          maxWidth={300}
        />
        <span className="text-[10px] uppercase tracking-wide" style={{ color: colors.textMuted }}>
          (optional · not scored)
        </span>
      </div>
      {summary.bullets.length > 0 ? (
        <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-sm leading-snug" style={{ color: colors.text }}>
          {summary.bullets.map((b) => (
            <li key={b.slice(0, 64)}>{b}</li>
          ))}
        </ul>
      ) : null}
      {summary.convictionNote ? (
        <p className="m-0 mt-2 text-xs leading-relaxed italic" style={{ color: colors.textMuted }}>
          {summary.convictionNote}
        </p>
      ) : null}
    </section>
  );
}
