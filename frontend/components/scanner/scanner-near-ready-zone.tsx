"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { NearReadyCardModel } from "@/lib/scanner/scanner-quiet-desk";
import { nearReadySectionCopy } from "@/lib/scanner/scanner-quiet-desk";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  cards: NearReadyCardModel[];
  regimeLabel: string;
};

export function ScannerNearReadyZone({ cards, regimeLabel }: Props) {
  const { colors } = useTheme();
  const { title, subtitle } = nearReadySectionCopy(regimeLabel);

  if (cards.length === 0) return null;

  return (
    <section
      data-testid="scanner-near-ready-zone"
      style={{
        padding: spacing[4],
        borderRadius: borderRadius.xl,
        border: `2px solid color-mix(in srgb, ${colors.caution} 45%, ${colors.accent})`,
        background: `color-mix(in srgb, ${colors.caution} 8%, ${colors.surface})`,
        boxShadow: `0 0 0 1px color-mix(in srgb, ${colors.caution} 12%, transparent)`
      }}
    >
      <header style={{ marginBottom: spacing[3] }}>
        <h3
          data-testid="scanner-near-ready-title"
          style={{
            margin: 0,
            fontSize: typography.scale.lg,
            fontWeight: 700,
            color: colors.text,
            lineHeight: 1.25
          }}
        >
          {title}
        </h3>
        <p
          data-testid="scanner-near-ready-subtitle"
          style={{
            margin: `${spacing[1]} 0 0`,
            fontSize: typography.scale.sm,
            fontWeight: 600,
            color: colors.caution,
            lineHeight: 1.45
          }}
        >
          {subtitle}
        </p>
      </header>

      <div style={{ display: "grid", gap: spacing[3] }}>
        {cards.map((card) => (
          <NearReadyCard key={`${card.symbol}-${card.desk}`} card={card} />
        ))}
      </div>
    </section>
  );
}

function NearReadyCard({ card }: { card: NearReadyCardModel }) {
  const { colors } = useTheme();
  const momentumColor =
    card.momentum === "improving"
      ? colors.bullish
      : card.momentum === "weakening"
        ? colors.bearish
        : card.momentum === "re_eval"
          ? colors.accent
          : colors.textMuted;

  return (
    <article
      data-testid={`scanner-near-ready-card-${card.symbol}`}
      style={{
        borderRadius: borderRadius.lg,
        border: `1px solid color-mix(in srgb, ${colors.border} 70%, ${colors.caution} 30%)`,
        background: colors.surface,
        padding: spacing[3]
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="font-mono font-bold"
            style={{ fontSize: typography.scale.base, color: colors.text, letterSpacing: "0.04em" }}
          >
            {card.symbol}
          </span>
          <span
            style={{
              fontSize: typography.scale.xs,
              fontWeight: 700,
              color: colors.caution,
              padding: `2px ${spacing[2]}`,
              borderRadius: borderRadius.md,
              border: `1px solid color-mix(in srgb, ${colors.caution} 40%, transparent)`,
              background: "rgba(245,158,11,0.08)"
            }}
          >
            {card.readinessHint}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: momentumColor }}>
            {card.momentumLabel}
          </span>
          <Link
            href={card.evidenceHref}
            className="inline-flex items-center gap-0.5 text-xs font-semibold"
            style={{ color: colors.accent }}
          >
            Evidence
            <ChevronRight size={14} aria-hidden />
          </Link>
        </div>
      </div>

      <ul
        style={{
          margin: `${spacing[2]} 0 0`,
          padding: 0,
          listStyle: "none",
          display: "grid",
          gap: 4,
          fontSize: typography.scale.sm,
          lineHeight: 1.5
        }}
      >
        {card.confirmedLines.map((line) => (
          <li key={line} style={{ color: colors.text }}>
            <span style={{ color: colors.bullish, marginRight: 6 }} aria-hidden>
              ✓
            </span>
            {line}
          </li>
        ))}
        <li style={{ color: colors.caution, fontWeight: 600 }}>
          <span style={{ marginRight: 6 }} aria-hidden>
            ⚠
          </span>
          {card.blockedLine}
        </li>
      </ul>
    </article>
  );
}
