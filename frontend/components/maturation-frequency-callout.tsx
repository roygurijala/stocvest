"use client";

import { InfoTip } from "@/components/info-tip";
import {
  expectedFrequencyForDesk,
  maturationFrequencyTooltip,
  type MaturationFrequencyDesk
} from "@/lib/maturation-expected-frequency";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  desk: MaturationFrequencyDesk;
  /** When true, show display-band legend (B47). */
  showDisplayBands?: boolean;
  testId?: string;
};

/** Compact cadence + progression expectation block. */
export function MaturationFrequencyCallout({
  desk,
  showDisplayBands = false,
  testId = "maturation-frequency-callout"
}: Props) {
  const { colors } = useTheme();
  const copy = expectedFrequencyForDesk(desk);

  return (
    <aside
      data-testid={testId}
      style={{
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted,
        display: "grid",
        gap: spacing[2]
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p
          className="m-0 text-[10px] font-bold uppercase tracking-[0.12em]"
          style={{ color: colors.textMuted }}
        >
          Expected evaluation cadence
        </p>
        <InfoTip text={maturationFrequencyTooltip(desk)} label="When watchlist maturation updates" maxWidth={340} />
      </div>
      <ul
        className="m-0 list-disc space-y-1 pl-5 text-xs leading-relaxed"
        style={{ color: colors.textMuted }}
      >
        <li>{copy.scheduled}</li>
        <li>{copy.onDemand}</li>
        <li>{copy.progression}</li>
        {showDisplayBands ? <li>{copy.displayBands}</li> : null}
      </ul>
    </aside>
  );
}
