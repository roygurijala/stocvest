"use client";

import { InfoTip } from "@/components/info-tip";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import {
  marketContextHeadline,
  type MarketContextFlags
} from "@/lib/signal-evidence/market-context-present";
import { useTheme } from "@/lib/theme-provider";

const MARKET_CONTEXT_TIP =
  "Advisory flags when a symbol is unseasoned, in an index-inclusion window, or tied to a tracked IPO ecosystem. " +
  "Does not change composite layer scores — use to sanity-check volume, news, and gap reads.";

type Props = {
  flags: MarketContextFlags;
  compact?: boolean;
  testId?: string;
};

export function MarketContextPanel({ flags, compact = false, testId = "market-context-panel" }: Props) {
  const { colors } = useTheme();
  if (flags.warnings.length === 0 && !flags.ipo_unseasoned && !flags.index_inclusion_window) {
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
      {flags.warnings.length > 0 ? (
        <ul className="m-0 mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed" style={{ color: colors.text }}>
          {flags.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <p className="m-0 mt-2 text-[10px] leading-snug" style={{ color: colors.textMuted }}>
        Informational — does not change actionable gates
      </p>
    </article>
  );
}
