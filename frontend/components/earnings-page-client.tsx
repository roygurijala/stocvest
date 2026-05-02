"use client";

import { useMemo, useState } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { EarningsEvent } from "@/lib/api/earnings";

interface EarningsPageClientProps {
  events: EarningsEvent[];
  watchlistSymbols: string[];
  notice?: string | null;
}

type Filter = "all" | "today" | "week" | "watchlist";

export function EarningsPageClient({ events, watchlistSymbols, notice }: EarningsPageClientProps) {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<Filter>("all");
  const today = new Date().toISOString().slice(0, 10);
  const endWeek = new Date(Date.now() + 7 * 86400 * 1000).toISOString().slice(0, 10);
  const watch = new Set(watchlistSymbols.map((s) => s.toUpperCase()));

  const rows = useMemo(() => {
    const merged = [...events].sort((a, b) => a.report_date.localeCompare(b.report_date) || a.symbol.localeCompare(b.symbol));
    return merged.filter((e) => {
      if (filter === "today") return e.report_date === today;
      if (filter === "week") return e.report_date >= today && e.report_date <= endWeek;
      if (filter === "watchlist") return watch.has(e.symbol.toUpperCase());
      return true;
    });
  }, [events, filter, today, endWeek, watch]);

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2], flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Earnings Calendar (30 Days)</h2>
        <div style={{ display: "inline-flex", gap: spacing[2] }}>
          {(["all", "today", "week", "watchlist"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              style={{
                borderRadius: borderRadius.full,
                border: `1px solid ${colors.border}`,
                background: filter === id ? "rgba(59,130,246,.15)" : "transparent",
                color: filter === id ? colors.accent : colors.text,
                padding: "4px 10px",
                cursor: "pointer",
                fontSize: typography.scale.xs
              }}
            >
              {id === "all" ? "All" : id === "today" ? "Today" : id === "week" ? "This Week" : "Watchlist only"}
            </button>
          ))}
        </div>
      </header>
      {notice ? (
        <p
          role="status"
          style={{
            margin: 0,
            padding: spacing[3],
            borderRadius: borderRadius.lg,
            background: "rgba(234,179,8,.12)",
            border: `1px solid ${colors.border}`,
            color: colors.text,
            fontSize: typography.scale.sm
          }}
        >
          {notice}
        </p>
      ) : null}
      <div style={{ overflowX: "auto", background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
          <thead>
            <tr style={{ color: colors.textMuted }}>
              <th align="left">Date</th>
              <th align="left">Symbol</th>
              <th align="left">Company</th>
              <th align="left">Time</th>
              <th align="left">Est EPS</th>
              <th align="left">Actual EPS</th>
              <th align="left">Surprise %</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: spacing[4], color: colors.textMuted, borderTop: `1px solid ${colors.border}` }}>
                  No earnings events found for the next 30 days. Data updates daily before market open.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const surprise = row.surprise_percent ?? null;
                const tone =
                  row.actual_eps == null
                    ? colors.textMuted
                    : (surprise ?? 0) > 0.2
                      ? colors.bullish
                      : (surprise ?? 0) < -0.2
                        ? colors.bearish
                        : colors.textMuted;
                return (
                  <tr key={`${row.symbol}-${row.report_date}-${idx}`} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td>{row.report_date}</td>
                    <td>{row.symbol}</td>
                    <td>{row.company_name}</td>
                    <td>{row.report_time === "before_market" ? "BMO" : row.report_time === "after_market" ? "AMC" : row.report_time}</td>
                    <td>{typeof row.estimated_eps === "number" ? row.estimated_eps.toFixed(2) : "-"}</td>
                    <td style={{ color: tone }}>{typeof row.actual_eps === "number" ? row.actual_eps.toFixed(2) : "Upcoming"}</td>
                    <td style={{ color: tone }}>
                      {typeof row.surprise_percent === "number"
                        ? `${row.surprise_percent >= 0 ? "+" : ""}${row.surprise_percent.toFixed(1)}%`
                        : "-"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
