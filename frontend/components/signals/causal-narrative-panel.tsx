"use client";

import { InfoTip } from "@/components/info-tip";
import type { CausalNarrative } from "@/lib/signal-evidence/causal-narrative";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const CAUSAL_TIP =
  "How STOCVEST links layer readings — environment (macro, internals) can mute sector and symbol-local layers. Informational only; does not change the Decision.";

type Props = {
  narrative: CausalNarrative;
  compact?: boolean;
};

export function CausalNarrativePanel({ narrative, compact = false }: Props) {
  const { colors } = useTheme();
  if (!narrative.summary && narrative.chain.length === 0) return null;

  return (
    <article
      className={surfaceGlowClassName}
      data-testid="causal-narrative-panel"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: compact ? spacing[3] : spacing[4]
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-base font-semibold" style={{ color: colors.text }}>
          Why layers read this way
        </h3>
        <InfoTip text={CAUSAL_TIP} label="Causal narrative" maxWidth={340} />
      </div>
      <p
        className="m-0 mt-2 text-sm leading-relaxed"
        style={{ color: colors.text }}
        data-testid="causal-narrative-summary"
      >
        {narrative.summary}
      </p>
      {narrative.chainLabel ? (
        <p className="m-0 mt-2 text-xs font-medium uppercase tracking-wide" style={{ color: colors.textMuted }}>
          Headwind chain: {narrative.chainLabel}
        </p>
      ) : null}
      {narrative.chain.length > 0 ? (
        <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
          {narrative.chain.map((note) => (
            <li
              key={note.layer}
              className="rounded-lg px-3 py-2 text-sm leading-snug"
              style={{ background: colors.surfaceMuted, border: `1px solid ${colors.border}` }}
              data-testid={`causal-chain-${note.layer}`}
            >
              <span className="font-semibold" style={{ color: colors.text }}>
                {note.name}
              </span>
              <span className="block mt-0.5" style={{ color: colors.textMuted }}>
                {note.because}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 mt-2 text-[10px] leading-snug" style={{ color: colors.textMuted }}>
        Informational — does not change actionable gates
      </p>
    </article>
  );
}
