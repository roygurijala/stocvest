"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDeskWhyMissing, type DeskTodayMode } from "@/lib/api/desk-today";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";

type Props = {
  symbol: string;
  lane: DeskTodayMode;
  evaluationTrace: ScannerEvaluationTraceRow[];
  colors: ThemeColors;
};

export function ScannerSymbolLookupPanel({ symbol, lane, evaluationTrace, colors }: Props) {
  const [whyLine, setWhyLine] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const traceRows = evaluationTrace.filter(
    (r) => r.symbol === symbol && (lane === "swing" ? r.desk === "swing" : r.desk === "day")
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const diag = await fetchDeskWhyMissing(lane, symbol);
        if (cancelled) return;
        if (diag?.reason?.trim()) {
          setWhyLine(diag.reason.trim());
        } else {
          setWhyLine(null);
        }
      } catch {
        if (!cancelled) setWhyLine(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, lane]);

  return (
    <div style={{ padding: spacing[4] }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
        Symbol lookup
      </p>
      <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{symbol}</h3>
      <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        {loading
          ? "Checking desk funnel and evaluation trace…"
          : whyLine
            ? whyLine
            : traceRows.length > 0
              ? "Not on today's actionable desk — see evaluation gates below."
              : `${symbol} is not in the current filtered funnel. It may be outside the survivor set or below desk gates.`}
      </p>

      {traceRows.length > 0 ? (
        <ul style={{ margin: `${spacing[3]} 0 0`, padding: 0, listStyle: "none", display: "grid", gap: spacing[2] }}>
          {traceRows.slice(0, 4).map((row, i) => (
            <li
              key={`${row.gate}-${i}`}
              style={{
                padding: spacing[2],
                borderRadius: borderRadius.sm,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceMuted ?? colors.surface,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                lineHeight: 1.45
              }}
            >
              <span style={{ fontWeight: 700, color: colors.text }}>{row.gate}</span>
              {" — "}
              {row.detail}
            </li>
          ))}
        </ul>
      ) : null}

      <div style={{ marginTop: spacing[4] }}>
        <Link
          href={`/dashboard?symbol=${encodeURIComponent(symbol)}&lane=${lane}`}
          style={{
            display: "inline-flex",
            padding: `${spacing[2]} ${spacing[3]}`,
            borderRadius: borderRadius.md,
            background: colors.accent,
            color: "#fff",
            fontSize: typography.scale.xs,
            fontWeight: 700,
            textDecoration: "none"
          }}
        >
          Open on dashboard →
        </Link>
      </div>
    </div>
  );
}
