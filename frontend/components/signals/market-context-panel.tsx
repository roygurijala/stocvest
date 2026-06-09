"use client";

import { InfoTip } from "@/components/info-tip";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import {
  marketContextHeadline,
  type MarketContextDampening,
  type MarketContextFlags
} from "@/lib/signal-evidence/market-context-present";
import { useTheme } from "@/lib/theme-provider";

const MARKET_CONTEXT_TIP =
  "IPO and index-inclusion windows can distort sector, internals, and technical reads. " +
  "When dampening is active, those layers contribute less weight — composite confidence is reduced, not hidden.";

type Props = {
  flags: MarketContextFlags;
  dampening?: MarketContextDampening | null;
  compact?: boolean;
  testId?: string;
};

function layerLabel(layer: string): string {
  return layer.charAt(0).toUpperCase() + layer.slice(1);
}

export function MarketContextPanel({
  flags,
  dampening = null,
  compact = false,
  testId = "market-context-panel"
}: Props) {
  const { colors } = useTheme();
  if (flags.warnings.length === 0 && !flags.ipo_unseasoned && !flags.index_inclusion_window && !dampening?.active) {
    return null;
  }

  const pills: string[] = [];
  if (flags.ipo_unseasoned) {
    pills.push(flags.listed_days != null ? `Unseasoned · ${flags.listed_days} sessions` : "Unseasoned listing");
  }
  if (flags.index_inclusion_window) pills.push("Index inclusion window");
  if (flags.ecosystem_entity) {
    const role = flags.ecosystem_role ? flags.ecosystem_role.replace(/_/g, " ") : "exposure";
    pills.push(`${flags.ecosystem_entity} · ${role}`);
  }
  if (dampening?.confidence_level === "reduced") pills.push("Composite confidence reduced");

  const showScoreCompare =
    dampening != null &&
    dampening.undampened_score !== dampening.adjusted_score &&
    dampening.dampened_layers.length > 0;

  return (
    <article
      className={surfaceGlowClassName}
      data-testid={testId}
      style={{
        background: "rgba(245,158,11,0.08)",
        border: "1px solid rgba(245,158,11,0.35)",
        borderRadius: borderRadius.xl,
        padding: compact ? spacing[3] : spacing[4]
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-sm font-semibold" style={{ color: colors.text }}>
          {marketContextHeadline(flags)}
        </h3>
        <InfoTip text={MARKET_CONTEXT_TIP} label="Market structure context" maxWidth={340} />
      </div>
      {pills.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {pills.map((pill) => (
            <span
              key={pill}
              className="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                background: "rgba(245,158,11,0.15)",
                color: colors.text,
                border: "1px solid rgba(245,158,11,0.4)"
              }}
            >
              {pill}
            </span>
          ))}
        </div>
      ) : null}

      {showScoreCompare ? (
        <p className="m-0 mt-2 text-sm leading-relaxed" style={{ color: colors.text }} data-testid="market-context-score-compare">
          Normal composite score would be{" "}
          <span style={{ fontWeight: 700 }}>{dampening!.undampened_score}</span> · adjusted score is{" "}
          <span style={{ fontWeight: 700 }}>{dampening!.adjusted_score}</span>
          {dampening!.window_end ? (
            <span style={{ color: colors.textMuted }}> (window through {dampening!.window_end})</span>
          ) : null}
        </p>
      ) : null}

      {dampening && dampening.dampened_layers.length > 0 ? (
        <ul className="m-0 mt-3 list-none space-y-2 p-0" data-testid="market-context-dampened-layers">
          {dampening.dampened_layers.map((row) => {
            const pct = Math.round(row.multiplier * 100);
            return (
              <li
                key={row.layer}
                className="rounded-lg px-3 py-2 text-sm"
                style={{
                  background: "rgba(0,0,0,0.2)",
                  border: "1px dashed rgba(245,158,11,0.45)",
                  color: colors.textMuted
                }}
              >
                <span style={{ fontWeight: 600, color: colors.text }}>{layerLabel(row.layer)}</span>
                <span className="ml-2 text-xs uppercase tracking-wide" style={{ color: colors.caution }}>
                  {pct}% weight
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {flags.warnings.length > 0 ? (
        <ul className="m-0 mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed" style={{ color: colors.text }}>
          {flags.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 mt-2 text-[10px] leading-snug" style={{ color: colors.textMuted }}>
        Informational — dampening reduces layer influence; actionable gates unchanged
      </p>
    </article>
  );
}
