"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import type {
  PositionOwner,
  PositionOwnerAction
} from "@/lib/dashboard/trading-room/position-fundamentals-present";
import type { useTheme } from "@/lib/theme-provider";

type Colors = ReturnType<typeof useTheme>["colors"];

type Props = {
  owner: PositionOwner;
  colors: Colors;
};

function actionColor(action: PositionOwnerAction, colors: Colors): string {
  if (action === "buy_more") return colors.bullish;
  if (action === "sell") return colors.bearish;
  if (action === "trim") return colors.caution;
  return colors.textMuted;
}

function fmtUsd(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

/**
 * Portfolio-aware "you own this" card on the Long-Term deep-dive. Shows YOUR cost basis,
 * unrealized P/L, tax holding-period, and the signal-first action derived from this same
 * composite. Renders only when the backend attached `position_owner` (i.e. the caller holds
 * the symbol). Action-oriented copy, so it carries the not-advice disclaimer.
 */
export function PositionOwnerCard({ owner, colors }: Props) {
  const accent = actionColor(owner.action, colors);
  const plTone =
    owner.unrealizedPl == null
      ? colors.textMuted
      : owner.unrealizedPl > 0
        ? colors.bullish
        : owner.unrealizedPl < 0
          ? colors.bearish
          : colors.textMuted;

  const label: React.CSSProperties = {
    margin: 0,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "1.4px",
    textTransform: "uppercase",
    color: colors.textMuted
  };
  const statLabel: React.CSSProperties = { fontSize: typography.scale.xs, color: colors.textMuted };
  const statValue: React.CSSProperties = {
    fontSize: typography.scale.sm,
    color: colors.text,
    fontWeight: 600
  };

  return (
    <article
      data-testid="position-owner-card"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: borderRadius.lg,
        padding: spacing[4],
        display: "flex",
        flexDirection: "column",
        gap: spacing[3]
      }}
    >
      <div>
        <p style={label}>Your position · STOCVEST-managed</p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            gap: spacing[2],
            marginTop: spacing[2]
          }}
        >
          <span
            data-testid="position-owner-action"
            style={{
              background: accent,
              color: "#fff",
              borderRadius: borderRadius.sm,
              padding: `2px ${spacing[2]}`,
              fontSize: typography.scale.xs,
              fontWeight: 700
            }}
          >
            {owner.actionLabel}
          </span>
          {owner.holderStance ? (
            <span style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>
              holder read: {owner.holderStance}
            </span>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: spacing[3]
        }}
      >
        <div>
          <div style={statLabel}>Shares</div>
          <div style={statValue}>
            {owner.quantity != null
              ? owner.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })
              : "—"}
            {owner.lotCount > 1 ? (
              <span style={{ color: colors.textMuted, fontWeight: 400 }}> · {owner.lotCount} lots</span>
            ) : null}
          </div>
        </div>
        <div>
          <div style={statLabel}>Avg cost</div>
          <div style={statValue}>{fmtUsd(owner.averageCost)}</div>
        </div>
        <div>
          <div style={statLabel}>Current price</div>
          <div style={statValue} data-testid="position-owner-price">
            {fmtUsd(owner.currentPrice)}
          </div>
        </div>
        <div>
          <div style={statLabel}>Market value</div>
          <div style={statValue}>{fmtUsd(owner.marketValue)}</div>
        </div>
        <div>
          <div style={statLabel}>Unrealized P/L</div>
          <div style={{ ...statValue, color: plTone }} data-testid="position-owner-pl">
            {fmtUsd(owner.unrealizedPl)}
            <span style={{ fontSize: typography.scale.xs }}> ({fmtPct(owner.unrealizedPlPct)})</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}>
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
          Tax holding-period: {owner.longTermLots} long-term / {owner.shortTermLots} short-term lot
          {owner.longTermLots + owner.shortTermLots === 1 ? "" : "s"}
          {owner.earliestPurchaseDate ? ` · first bought ${owner.earliestPurchaseDate}` : ""}
        </p>
        {owner.taxLotHint ? (
          <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
            {owner.taxLotHint}
          </p>
        ) : null}
      </div>

      {owner.disclaimer ? (
        <p
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.45,
            fontStyle: "italic"
          }}
        >
          {owner.disclaimer}
        </p>
      ) : null}
    </article>
  );
}
