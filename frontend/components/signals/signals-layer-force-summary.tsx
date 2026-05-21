"use client";

import {
  formatLayerForceNames,
  groupLayersByForce,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  rows: SignalsLayerRowInput[];
  bias: SignalsSetupBias;
};

export function SignalsLayerForceSummary({ rows, bias }: Props) {
  const { colors } = useTheme();
  const groups = groupLayersByForce(rows, bias);
  const hasForces =
    groups.withBias.length > 0 || groups.againstOrMixed.length > 0 || groups.noEdge.length > 0;

  if (!hasForces) return null;

  return (
    <div
      className="mt-3 grid gap-3 sm:grid-cols-2"
      data-testid="signals-layer-force-summary"
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted,
        padding: spacing[3]
      }}
    >
      <ForceColumn
        title={groups.titles.withBias}
        names={formatLayerForceNames(groups.withBias)}
        tone="support"
        colors={colors}
        testId="signals-layer-force-with-bias"
      />
      <ForceColumn
        title={groups.titles.againstOrMixed}
        names={formatLayerForceNames(groups.againstOrMixed)}
        tone="oppose"
        colors={colors}
        testId="signals-layer-force-against"
      />
      {groups.noEdge.length > 0 ? (
        <div className="sm:col-span-2">
          <ForceColumn
            title={groups.titles.noEdge}
            names={formatLayerForceNames(groups.noEdge)}
            tone="muted"
            colors={colors}
            testId="signals-layer-force-neutral"
          />
        </div>
      ) : null}
      <p className="m-0 sm:col-span-2 text-[11px] leading-relaxed" style={{ color: colors.textMuted }}>
        Level scores show today&apos;s layer read, not how much each layer weighs in the composite.
        Structure and breadth usually matter more than a single headline.
      </p>
    </div>
  );
}

function ForceColumn({
  title,
  names,
  tone,
  colors,
  testId
}: {
  title: string;
  names: string;
  tone: "support" | "oppose" | "muted";
  colors: ReturnType<typeof useTheme>["colors"];
  testId: string;
}) {
  const accent =
    tone === "support" ? colors.bullish : tone === "oppose" ? colors.caution : colors.textMuted;

  return (
    <div data-testid={testId}>
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: accent }}>
        {title}
      </p>
      <p className="m-0 mt-1 text-sm leading-snug" style={{ color: colors.text }}>
        {names}
      </p>
    </div>
  );
}
