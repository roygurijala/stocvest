"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchDeskToday, type DeskTodayResponse } from "@/lib/api/desk-today";
import { buildQuietLeaderCardModel, quietLeadersFromDesk } from "@/lib/dashboard/quiet-leaders-present";
import { hotInMarketSignalsHref } from "@/lib/dashboard/hot-in-market-card-present";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  /** Only swing mode shows quiet leaders. */
  scannerMode: "swing" | "day" | "both";
};

export function ScannerQuietLeadersSection({ scannerMode }: Props) {
  const { colors } = useTheme();
  const [desk, setDesk] = useState<DeskTodayResponse | null>(null);

  useEffect(() => {
    if (scannerMode === "day") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchDeskToday("swing");
        if (!cancelled) setDesk(res);
      } catch {
        if (!cancelled) setDesk(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scannerMode]);

  const leaders = useMemo(() => quietLeadersFromDesk(desk?.data ?? null), [desk?.data]);

  if (scannerMode === "day" || leaders.length === 0) return null;

  return (
    <section
      id="scanner-quiet-leaders"
      data-testid="scanner-quiet-leaders"
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
        Quiet leaders
      </p>
      <p style={{ margin: `0 0 ${spacing[3]}`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        Strong swing structure, low session velocity — screened from the full market, not the gap-mover list.
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
        {leaders.map((row, index) => {
          const model = buildQuietLeaderCardModel(row, {
            rank: index + 1,
            mode: "swing",
            colors: {
              surface: colors.surface,
              border: colors.border,
              accent: colors.accent,
              bullish: colors.bullish,
              bearish: colors.bearish,
              caution: colors.caution,
              textMuted: colors.textMuted
            }
          });
          return (
            <li
              key={row.symbol}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: spacing[2],
                padding: spacing[2],
                borderRadius: borderRadius.md,
                border: `1px solid ${colors.border}`
              }}
            >
              <div>
                <span style={{ fontWeight: 700 }}>{row.symbol}</span>
                <span style={{ marginLeft: spacing[2], fontSize: typography.scale.xs, color: colors.textMuted }}>
                  {model.gapLine} · {model.detailLine}
                </span>
              </div>
              <Link
                href={hotInMarketSignalsHref(row.symbol, "swing")}
                style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.accent }}
              >
                Signals →
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
