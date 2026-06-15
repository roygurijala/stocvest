"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { useTheme } from "@/lib/theme-provider";
import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";

type Colors = ReturnType<typeof useTheme>["colors"];

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function SessionMoverContext({
  card,
  company,
  price,
  changePct,
  colors
}: {
  card: FeedCard;
  company?: string | null;
  price: number | null;
  changePct: number | null;
  colors: Colors;
}) {
  const pctTone =
    changePct == null ? colors.textMuted : changePct >= 0 ? colors.bullish : colors.bearish;

  return (
    <article
      data-testid="session-mover-context"
      style={{
        background: colors.surfaceMuted,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        padding: `${spacing[3]} ${spacing[4]}`,
        display: "flex",
        flexDirection: "column",
        gap: spacing[3]
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: colors.caution,
            background: `${colors.caution}18`,
            padding: "3px 8px",
            borderRadius: borderRadius.full
          }}
        >
          Session mover
        </span>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, fontWeight: 600 }}>
          Not a vetted setup
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: spacing[2] }}>
        <span style={{ fontSize: typography.scale.lg, fontWeight: 800, color: colors.text }}>{card.symbol}</span>
        {company ? (
          <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, fontWeight: 500 }}>{company}</span>
        ) : null}
        <span style={{ fontSize: typography.scale.base, fontWeight: 700, color: colors.text, fontVariantNumeric: "tabular-nums" }}>
          {fmtPrice(price)}
        </span>
        {changePct != null ? (
          <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: pctTone, fontVariantNumeric: "tabular-nums" }}>
            {fmtPct(changePct)}
          </span>
        ) : null}
      </div>

      <p style={{ margin: 0, fontSize: typography.scale.sm, lineHeight: 1.65, color: colors.text }}>
        {card.verdict?.trim() ||
          "Session activity from desk radar — momentum and context only. Scenario geometry and desk gates apply only after a symbol passes the full quality stack."}
      </p>

      <p style={{ margin: 0, fontSize: typography.scale.xs, lineHeight: 1.55, color: colors.textMuted }}>
        Add to your watchlist to track structure as it forms. Full entry geometry appears when the symbol clears discovery
        or scanner gates — not from session momentum alone.
      </p>

      <div>
        <AddToWatchlistButton symbol={card.symbol} />
      </div>
    </article>
  );
}
