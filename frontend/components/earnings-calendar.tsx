"use client";

import { useMemo } from "react";
import { DecisionMetric } from "@/components/decision-metric";
import { InfoTip } from "@/components/info-tip";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { EarningsEvent } from "@/lib/api/earnings";
import { EARNINGS_CALENDAR_CARD_TIP, EARNINGS_EPS_SURPRISE_TIP, EARNINGS_IMPACT_BADGE_TIP } from "@/lib/ui-tooltips";

interface EarningsCalendarProps {
  events: EarningsEvent[];
  title?: string;
  maxDays?: number;
  className?: string;
  /** Circled (i) top-right — what this calendar is for on the dashboard. */
  infoTip?: string;
}

function dayKey(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toISOString().slice(0, 10);
}

function impactLabel(marketCap?: number | null): "high" | "medium" | "low" {
  const cap = typeof marketCap === "number" ? marketCap : 0;
  if (cap >= 200_000_000_000) return "high";
  if (cap >= 20_000_000_000) return "medium";
  return "low";
}

function earningsTimingLabel(reportTime: EarningsEvent["report_time"]): "BMO" | "AMC" | "DURING" | "TBD" {
  if (reportTime === "before_market") return "BMO";
  if (reportTime === "after_market") return "AMC";
  if (reportTime === "during_market") return "DURING";
  return "TBD";
}

export function EarningsCalendar({
  events,
  title = "Earnings Calendar",
  maxDays = 7,
  className,
  infoTip = EARNINGS_CALENDAR_CARD_TIP
}: EarningsCalendarProps) {
  const { colors } = useTheme();
  const today = new Date().toISOString().slice(0, 10);
  const grouped = useMemo(() => {
    const rows = [...events]
      .filter((e) => !!e.report_date)
      .sort((a, b) => a.report_date.localeCompare(b.report_date) || a.symbol.localeCompare(b.symbol));
    const map = new Map<string, EarningsEvent[]>();
    for (const row of rows) {
      const k = dayKey(row.report_date);
      const existing = map.get(k) || [];
      existing.push(row);
      map.set(k, existing);
    }
    return [...map.entries()].slice(0, maxDays);
  }, [events, maxDays]);

  if (grouped.length === 0) return null;

  return (
    <section
      className={className ? `${className} ${surfaceGlowClassName}` : surfaceGlowClassName}
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: spacing[2], marginBottom: spacing[1] }}>
        <h3 style={{ margin: 0, flex: 1, minWidth: 0 }}>{title}</h3>
        <InfoTip text={infoTip} label={`About ${title}`} maxWidth={300} />
      </div>
      <div style={{ display: "grid", gap: spacing[3] }}>
        {grouped.map(([date, rows]) => {
          const isToday = date === today;
          return (
            <article
              key={date}
              className={surfaceGlowClassName}
              style={{
                border: `1px solid ${isToday ? "rgba(245,158,11,.5)" : colors.border}`,
                background: isToday ? "rgba(245,158,11,.1)" : "transparent",
                borderRadius: borderRadius.lg,
                padding: spacing[3]
              }}
            >
              <strong>{new Date(`${date}T00:00:00Z`).toLocaleDateString()}</strong>
              <div style={{ display: "grid", gap: spacing[2], marginTop: spacing[2] }}>
                {rows.map((row) => {
                  const impact = impactLabel(row.market_cap);
                  const epsDiff =
                    typeof row.actual_eps === "number" && typeof row.estimated_eps === "number"
                      ? row.actual_eps - row.estimated_eps
                      : null;
                  const epsColor = epsDiff == null ? colors.textMuted : epsDiff > 0 ? colors.bullish : epsDiff < 0 ? colors.bearish : colors.textMuted;
                  return (
                    <div
                      key={`${row.symbol}-${row.report_date}`}
                      className="min-w-0"
                      style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto auto", gap: spacing[2], alignItems: "center" }}
                    >
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: borderRadius.full,
                          background: colors.surfaceMuted,
                          display: "inline-grid",
                          placeItems: "center",
                          fontSize: 10
                        }}
                      >
                        {row.symbol.slice(0, 2)}
                      </span>
                      <span style={{ fontSize: typography.scale.sm }}>
                        <strong>{row.symbol}</strong> <span style={{ color: colors.textMuted }}>{row.company_name}</span>
                      </span>
                      <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>{earningsTimingLabel(row.report_time)}</span>
                      <DecisionMetric explanation={EARNINGS_IMPACT_BADGE_TIP} label="How earnings impact label is used" maxWidth={280}>
                        <span
                          style={{
                            borderRadius: borderRadius.full,
                            padding: "2px 8px",
                            fontSize: typography.scale.xs,
                            background: impact === "high" ? "rgba(239,68,68,.14)" : impact === "medium" ? "rgba(245,158,11,.14)" : "rgba(148,163,184,.14)",
                            color: impact === "high" ? colors.bearish : impact === "medium" ? colors.caution : colors.textMuted
                          }}
                        >
                          {impact}
                        </span>
                      </DecisionMetric>
                      {typeof row.actual_eps === "number" ? (
                        <div style={{ gridColumn: "2 / 5", color: epsColor, fontSize: typography.scale.xs }}>
                          <DecisionMetric explanation={EARNINGS_EPS_SURPRISE_TIP} label="How EPS vs estimate is used" maxWidth={300}>
                            <span>
                              EPS {row.actual_eps.toFixed(2)} vs est{" "}
                              {typeof row.estimated_eps === "number" ? row.estimated_eps.toFixed(2) : "n/a"}
                              {typeof row.surprise_percent === "number"
                                ? ` (${row.surprise_percent >= 0 ? "+" : ""}${row.surprise_percent.toFixed(1)}%)`
                                : ""}
                            </span>
                          </DecisionMetric>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
