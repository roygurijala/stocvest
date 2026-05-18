"use client";

import Link from "next/link";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { roleAccents } from "@/lib/design-system";
import type { ScannerNearQualificationRow, ScannerWatchlistProgressionRow } from "@/lib/scanner-scan-summary";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  nearQualification: ScannerNearQualificationRow[];
  watchlistProgression: ScannerWatchlistProgressionRow[];
};

export function ScannerNearQualificationSection({ nearQualification, watchlistProgression }: Props) {
  if (nearQualification.length === 0 && watchlistProgression.length === 0) return null;

  const { colors, theme } = useTheme();

  return (
    <section
      id="scanner-near-qualification"
      data-testid="scanner-near-qualification"
      style={{ display: "grid", gap: spacing[3] }}
    >
      {nearQualification.length > 0 ? (
        <div
          style={{
            padding: spacing[4],
            borderRadius: borderRadius.xl,
            border: `1px solid ${colors.border}`,
            background: colors.surface
          }}
        >
          <p
            style={{
              margin: `0 0 ${spacing[2]}`,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            Approaching threshold
          </p>
          <p style={{ margin: `0 0 ${spacing[3]}`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
            Below the setup score floor but showing layer alignment — not actionable entries.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
            {nearQualification.map((row) => (
              <NearRow key={`${row.symbol}-${row.desk}`} row={row} colors={colors} theme={theme} />
            ))}
          </ul>
        </div>
      ) : null}

      {watchlistProgression.length > 0 ? (
        <div
          data-testid="scanner-watchlist-progression"
          style={{
            padding: spacing[4],
            borderRadius: borderRadius.xl,
            border: `1px solid ${colors.border}`,
            background: colors.surface
          }}
        >
          <p
            style={{
              margin: `0 0 ${spacing[2]}`,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: colors.textMuted
            }}
          >
            Watchlist progression
          </p>
          <p style={{ margin: `0 0 ${spacing[3]}`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
            Maturation on your default watchlist — evidence-based, independent of scanner filters.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
            {watchlistProgression.map((row) => (
              <ProgressionRow key={`${row.symbol}-${row.desk}`} row={row} colors={colors} theme={theme} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function NearRow({
  row,
  colors,
  theme
}: {
  row: ScannerNearQualificationRow;
  colors: ReturnType<typeof useTheme>["colors"];
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const accent = roleAccents[theme][row.desk === "swing" ? "swing" : "day"];
  const align = row.alignment?.label ?? `${(row.score * 100).toFixed(0)}% score`;
  const away = row.layers_away;
  return (
    <li
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing[2],
        padding: spacing[2],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: `color-mix(in srgb, ${accent.borderAccent} 8%, ${colors.surface})`
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: spacing[2] }}>
        <span className="font-mono font-bold" style={{ color: colors.text }}>
          {row.symbol}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            color: accent.borderAccent
          }}
        >
          {row.desk}
        </span>
        <span style={{ fontSize: typography.scale.sm, color: colors.textMuted }}>{align}</span>
      </div>
      {typeof away === "number" && away > 0 ? (
        <span style={{ width: "100%", fontSize: typography.scale.xs, color: colors.textMuted }}>
          Approaching actionable band — not a trade signal.
        </span>
      ) : null}
      <Link
        href={`/dashboard/signals?ref=scanner&symbol=${encodeURIComponent(row.symbol)}&trading_mode=${row.desk}`}
        style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.accent, textDecoration: "none" }}
      >
        Open Signals →
      </Link>
    </li>
  );
}

function ProgressionRow({
  row,
  colors,
  theme
}: {
  row: ScannerWatchlistProgressionRow;
  colors: ReturnType<typeof useTheme>["colors"];
  theme: ReturnType<typeof useTheme>["theme"];
}) {
  const accent = roleAccents[theme][row.desk === "swing" ? "swing" : "day"];
  return (
    <li
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing[2],
        padding: spacing[2],
        borderRadius: borderRadius.md,
        border: `1px solid ${colors.border}`,
        background: colors.surfaceMuted
      }}
    >
      <div>
        <span className="font-mono font-bold" style={{ color: colors.text }}>
          {row.symbol}
        </span>
        <span style={{ marginLeft: spacing[2], fontSize: 10, fontWeight: 700, color: accent.borderAccent }}>
          {row.desk.toUpperCase()}
        </span>
        <span style={{ marginLeft: spacing[2], fontSize: typography.scale.sm, color: colors.textMuted }}>
          {row.label}
        </span>
        {typeof row.layers_away === "number" && row.layers_away > 0 ? (
          <span style={{ marginLeft: spacing[2], fontSize: typography.scale.xs, color: colors.textMuted }}>
            · {row.layers_away === 1 ? "1 layer from threshold" : `${row.layers_away} layers from threshold`}
          </span>
        ) : null}
      </div>
      <Link
        href={`/dashboard/watchlists?focus=${encodeURIComponent(row.symbol)}`}
        style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.accent, textDecoration: "none" }}
      >
        Watchlist →
      </Link>
    </li>
  );
}
