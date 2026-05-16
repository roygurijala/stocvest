"use client";

import { REFERENCE_LEVEL_HINTS } from "@/lib/signals-page-present";
import type { SessionReferenceLevels } from "@/lib/snapshot-reference-levels";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  levels: SessionReferenceLevels;
  setupPattern?: string | null;
};

function fmt(price: number | null): string {
  return price != null ? `$${price.toFixed(2)}` : "n/a";
}

export function SignalsReferenceLevels({ levels, setupPattern }: Props) {
  const { colors } = useTheme();
  const orHigh = levels.resistance != null ? levels.resistance * 1.003 : null;
  const orLow = levels.support != null ? levels.support * 0.997 : null;

  const items = [
    { key: "vwap", label: "VWAP", value: levels.vwap, hint: REFERENCE_LEVEL_HINTS.vwap },
    { key: "support", label: "Support", value: levels.support, hint: REFERENCE_LEVEL_HINTS.support },
    { key: "resistance", label: "Resistance", value: levels.resistance, hint: REFERENCE_LEVEL_HINTS.resistance },
    { key: "orHigh", label: "OR High", value: orHigh, hint: REFERENCE_LEVEL_HINTS.orHigh },
    { key: "orLow", label: "OR Low", value: orLow, hint: REFERENCE_LEVEL_HINTS.orLow }
  ] as const;

  return (
    <article
      className={surfaceGlowClassName}
      data-testid="signals-reference-levels"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      <h3 className="m-0" style={{ fontSize: typography.scale.lg }}>
        Reference Levels
      </h3>
      <p className="m-0 mt-1 text-xs leading-snug" style={{ color: colors.textMuted }}>
        Context only — not entry signals
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {items.map((item) => (
          <div key={item.key}>
            <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
              {item.label}
            </p>
            <p className="m-0 text-sm font-semibold" style={{ color: colors.text }}>
              {fmt(item.value)}
            </p>
            <p className="m-0 text-[10px] leading-snug" style={{ color: colors.textMuted, opacity: 0.85 }}>
              {item.hint}
            </p>
          </div>
        ))}
      </div>
      {setupPattern ? (
        <p className="m-0 mt-3 text-sm" style={{ color: colors.textMuted }}>
          Pattern context: {setupPattern}
        </p>
      ) : null}
    </article>
  );
}
