"use client";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { volumeGapAriaLabel } from "@/lib/scanner-volume-gap";
import { useTheme } from "@/lib/theme-provider";

const VOLUME_GAP_FILL = "#d97706";

type VolumeGapBarProps = {
  symbol: string;
  /** 0–100: share of required session volume met (higher = closer to qualifying). */
  fillPct: number;
  /** When provided, used for an accessible label alongside fill %. */
  pctBelow?: number;
  testId?: string;
  /** e.g. "Best on volume (still below threshold)" — only on the top relative row. */
  rankNote?: string;
};

export function VolumeGapBar({ symbol, fillPct, pctBelow, testId, rankNote }: VolumeGapBarProps) {
  const { colors } = useTheme();
  const fill = Math.max(0, Math.min(100, Math.round(fillPct)));
  const barTestId = testId ?? `scanner-volume-gap-${symbol}`;

  return (
    <div
      className="scanner-volume-gap"
      data-testid={barTestId}
      style={{ display: "grid", gap: spacing[1] }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "3.25rem minmax(0, 1fr)",
          alignItems: "center",
          gap: spacing[2]
        }}
      >
        <span
          className="font-mono font-semibold"
          style={{ fontSize: typography.scale.sm, color: colors.text }}
        >
          {symbol}
        </span>
        <div
          role="progressbar"
          aria-valuenow={fill}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={volumeGapAriaLabel(symbol, fill, pctBelow)}
          data-testid={`${barTestId}-track`}
          style={{
            height: 6,
            borderRadius: borderRadius.sm,
            background: colors.border,
            overflow: "hidden"
          }}
        >
          <div
            data-testid={`${barTestId}-fill`}
            style={{
              width: `${fill}%`,
              height: "100%",
              borderRadius: borderRadius.sm,
              background: VOLUME_GAP_FILL,
              minWidth: fill > 0 ? 2 : 0,
              transition: "width 0.2s ease"
            }}
          />
        </div>
      </div>
      {rankNote ? (
        <p
          data-testid={`${barTestId}-rank-note`}
          style={{
            margin: 0,
            paddingLeft: "3.25rem",
            fontSize: 10,
            fontWeight: 600,
            color: colors.textMuted,
            lineHeight: 1.4
          }}
        >
          {rankNote}
        </p>
      ) : null}
    </div>
  );
}

type VolumeGapRow = { symbol: string; pct_below: number };

export function VolumeGapBarList({
  rows,
  limit = 5,
  testIdPrefix = "scanner-volume-gap",
  showCaption = true
}: {
  rows: VolumeGapRow[];
  limit?: number;
  testIdPrefix?: string;
  showCaption?: boolean;
}) {
  const { colors } = useTheme();
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.pct_below - b.pct_below);
  const preview = sorted.slice(0, limit);
  const overflow = sorted.length - preview.length;

  return (
    <div style={{ display: "grid", gap: spacing[2] }}>
      {showCaption ? (
        <p
          data-testid={`${testIdPrefix}-caption`}
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.45
          }}
        >
          Bars show % of required session pace met. Tallest bar = best among weak participation — not
          near-ready.
        </p>
      ) : null}
      <ul
        className="scanner-volume-gap-list"
        style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing[2] }}
      >
        {preview.map((row, index) => (
          <li key={row.symbol}>
            <VolumeGapBar
              symbol={row.symbol}
              fillPct={100 - row.pct_below}
              pctBelow={row.pct_below}
              testId={`${testIdPrefix}-${row.symbol}`}
              rankNote={
                index === 0
                  ? "Best on volume (still below threshold — not near-ready)"
                  : undefined
              }
            />
          </li>
        ))}
        {overflow > 0 ? (
          <li
            data-testid={`${testIdPrefix}-overflow`}
            style={{
              fontSize: typography.scale.xs,
              color: colors.textMuted,
              paddingLeft: "3.25rem"
            }}
          >
            + {overflow} more
          </li>
        ) : null}
      </ul>
    </div>
  );
}
