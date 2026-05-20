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
        padding: spacing[5],
        borderRadius: borderRadius.xl,
        border: `2px solid color-mix(in srgb, ${colors.caution} 55%, ${colors.accent})`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${colors.caution} 12%, ${colors.surface}) 0%, ${colors.surface} 100%)`,
        boxShadow: `0 0 24px color-mix(in srgb, ${colors.caution} 18%, transparent), 0 0 0 1px color-mix(in srgb, ${colors.caution} 15%, transparent)`
      }}
    >
      <header style={{ marginBottom: spacing[4] }}>
        <p
          style={{
            margin: `0 0 ${spacing[1]}`,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: colors.caution
          }}
        >
          Primary focus
        </p>
        <h3
          data-testid="scanner-near-ready-title"
          style={{
            margin: 0,
            fontSize: typography.scale.xl,
            fontWeight: 700,
            color: colors.text,
            lineHeight: 1.2
          }}
        >
          {title}
        </h3>
        <p
          data-testid="scanner-near-ready-subtitle"
          style={{
            margin: `${spacing[2]} 0 0`,
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
        border: `1px solid color-mix(in srgb, ${colors.caution} 35%, ${colors.border})`,
        background: colors.surface,
        padding: spacing[4],
        boxShadow: `0 1px 0 color-mix(in srgb, ${colors.caution} 20%, transparent)`
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="font-mono font-bold"
            style={{ fontSize: typography.scale.lg, color: colors.text, letterSpacing: "0.04em" }}
          >
            {card.symbol}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              color: colors.textMuted,
              padding: `2px ${spacing[2]}`,
              borderRadius: borderRadius.sm,
              border: `1px solid ${colors.border}`
            }}
          >
            {card.deskLabel}
          </span>
          <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: momentumColor }}>
            {card.alignmentHeadline}
          </span>
        </div>
        <Link
          href={card.evidenceHref}
          className="inline-flex items-center gap-0.5 text-xs font-semibold"
          style={{ color: colors.accent }}
        >
          Evidence
          <ChevronRight size={14} aria-hidden />
        </Link>
      </div>

      <p
        style={{
          margin: `${spacing[2]} 0 0`,
          fontSize: typography.scale.sm,
          fontWeight: 600,
          color: colors.caution
        }}
      >
        {card.readinessHint}
      </p>

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
        {card.urgencyLine ? (
          <li style={{ color: colors.text, fontWeight: 600 }}>{card.urgencyLine}</li>
        ) : null}
      </ul>
    </article>
  );
}
