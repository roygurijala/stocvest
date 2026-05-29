"use client";

import { Clock } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import type { EarningsEvent } from "@/lib/api/earnings";
import { earningsSectorLabel } from "@/lib/earnings-sector-label";
import {
  earningsCompanyLabel,
  earningsShowsReportedActual,
  earningsTimingLabel,
  formatEarningsGroupHeader,
  isHighMarketImpact
} from "@/lib/earnings-row-present";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

interface EarningsPageClientProps {
  events: EarningsEvent[];
  notice?: string | null;
  source?: string | null;
  watchlistSymbols?: string[];
}

type Filter = "upcoming" | "today" | "week" | "all";

const MONO = `'DM Mono', 'IBM Plex Mono', ${typography.fontFamilyMono}`;

/** Symbol (stacked) · Sector · Time · Est · Actual · Surprise */
const TABLE_GRID =
  "minmax(11rem,1.5fr) minmax(4.25rem,5.25rem) 2.75rem minmax(3.75rem,4.5rem) minmax(3.75rem,4.5rem) minmax(4rem,4.75rem)";

const SOURCE_LABELS: Record<string, string> = {
  finnhub: "Finnhub",
  benzinga: "Benzinga",
  polygon: "Polygon",
  fmp: "FMP"
};

function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mondayOfWeekContaining(refIso: string): string {
  const [y, mo, da] = refIso.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addDays(iso: string, delta: number): string {
  const [y, mo, da] = iso.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  d.setDate(d.getDate() + delta);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function fridayOfSameWeek(mondayIso: string): string {
  return addDays(mondayIso, 4);
}

function sortRows(list: EarningsEvent[]): EarningsEvent[] {
  return [...list].sort((a, b) => a.report_date.localeCompare(b.report_date) || a.symbol.localeCompare(b.symbol));
}

type RowGroup = { key: string; reportDate: string; rows: EarningsEvent[] };

function buildDateGroups(rows: EarningsEvent[]): RowGroup[] {
  const sorted = sortRows(rows);
  const byDate = new Map<string, EarningsEvent[]>();
  for (const e of sorted) {
    const list = byDate.get(e.report_date) ?? [];
    list.push(e);
    byDate.set(e.report_date, list);
  }
  return [...byDate.keys()].sort().map((d) => ({
    key: d,
    reportDate: d,
    rows: byDate.get(d)!
  }));
}

function TableHeader({ colors }: { colors: ReturnType<typeof useTheme>["colors"] }) {
  return (
    <div
      role="row"
      style={{
        display: "grid",
        gridTemplateColumns: TABLE_GRID,
        columnGap: spacing[3],
        alignItems: "end",
        padding: `${spacing[2]} ${spacing[3]}`,
        borderBottom: `1px solid ${colors.border}`,
        fontSize: "10px",
        textTransform: "uppercase",
        letterSpacing: "1.5px",
        color: colors.textMuted,
        fontFamily: typography.fontFamilySans
      }}
    >
      <span>Symbol</span>
      <span>Sector</span>
      <span>Time</span>
      <span style={{ textAlign: "right" }}>Est EPS</span>
      <span style={{ textAlign: "right" }}>Actual</span>
      <span style={{ textAlign: "right" }}>Surprise</span>
    </div>
  );
}

function EarningsLegend({ colors }: { colors: ReturnType<typeof useTheme>["colors"] }) {
  const itemStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: typography.scale.xs,
    color: colors.textMuted
  };
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: spacing[3],
        alignItems: "center",
        padding: `${spacing[2]} 0 0`
      }}
    >
      <span style={itemStyle}>
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: borderRadius.full,
            background: colors.accent,
            flexShrink: 0
          }}
        />
        High market impact
      </span>
      <span style={itemStyle}>
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: borderRadius.full,
            border: `2px solid ${colors.bullish}`,
            background: "transparent",
            flexShrink: 0
          }}
        />
        On your watchlist
      </span>
      <span style={itemStyle}>
        <Clock size={12} strokeWidth={2} aria-hidden style={{ flexShrink: 0, opacity: 0.85 }} />
        BMO = before open · AMC = after close
      </span>
    </div>
  );
}

function EarningsRow({
  row,
  today,
  colors,
  onWatchlist
}: {
  row: EarningsEvent;
  today: string;
  colors: ReturnType<typeof useTheme>["colors"];
  onWatchlist: boolean;
}) {
  const est = row.estimated_eps;
  const reported = earningsShowsReportedActual(row, today);
  const act = reported && typeof row.actual_eps === "number" ? row.actual_eps : null;
  const surprise = reported && typeof row.surprise_percent === "number" ? row.surprise_percent : null;
  const beatGreen = colors.bullish;
  const missRed = colors.bearish;
  const highImpact = isHighMarketImpact(row);
  const company = earningsCompanyLabel(row);
  const sector = earningsSectorLabel(row.symbol, row.company_name);

  let surpriseText = "—";
  let surpriseColor = colors.textMuted;
  if (surprise !== null) {
    surpriseText = `${surprise >= 0 ? "+" : ""}${surprise.toFixed(1)}%`;
    surpriseColor = surprise >= 0 ? beatGreen : missRed;
  }

  let actualColor = colors.textMuted;
  let actualText = "—";
  if (act !== null) {
    actualText = act.toFixed(2);
    actualColor = colors.text;
    if (typeof est === "number") {
      if (act > est) actualColor = beatGreen;
      else if (act < est) actualColor = missRed;
    }
  }

  return (
    <div
      role="row"
      className="earnings-table-row"
      style={{
        display: "grid",
        gridTemplateColumns: TABLE_GRID,
        columnGap: spacing[3],
        alignItems: "center",
        padding: `${spacing[3]} ${spacing[3]}`,
        borderBottom: `1px solid ${colors.border}`,
        fontFamily: typography.fontFamilySans,
        transition: "background 0.12s ease"
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = colors.surfaceMuted;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2], minWidth: 0 }}>
        {onWatchlist ? (
          <span
            aria-label="On your watchlist"
            title="On your watchlist"
            style={{
              width: 10,
              height: 10,
              borderRadius: borderRadius.full,
              border: `2px solid ${colors.bullish}`,
              flexShrink: 0
            }}
          />
        ) : highImpact ? (
          <span
            aria-label="High market impact"
            style={{
              width: 8,
              height: 8,
              borderRadius: borderRadius.full,
              background: colors.accent,
              flexShrink: 0
            }}
          />
        ) : (
          <span style={{ width: 10, flexShrink: 0 }} aria-hidden />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: spacing[2], flexWrap: "wrap" }}>
            <span style={{ fontSize: typography.scale.sm, fontWeight: 700, letterSpacing: "0.04em" }}>{row.symbol}</span>
            {highImpact ? (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  color: colors.accent,
                  background: `color-mix(in srgb, ${colors.accent} 18%, transparent)`,
                  padding: "2px 8px",
                  borderRadius: borderRadius.full,
                  whiteSpace: "nowrap"
                }}
              >
                High impact
              </span>
            ) : null}
          </div>
          <div
            style={{
              fontSize: typography.scale.xs,
              color: colors.textMuted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 2
            }}
            title={company}
          >
            {company}
          </div>
        </div>
      </div>
      <span style={{ fontSize: typography.scale.sm, color: colors.text }}>{sector}</span>
      <span style={{ fontSize: "10px", fontWeight: 600, color: colors.textMuted }}>{earningsTimingLabel(row.report_time)}</span>
      <span style={{ fontSize: typography.scale.sm, fontFamily: MONO, textAlign: "right", color: colors.textMuted }}>
        {typeof est === "number" ? est.toFixed(2) : "—"}
      </span>
      <span style={{ fontSize: typography.scale.sm, fontFamily: MONO, textAlign: "right", color: actualColor }}>{actualText}</span>
      <span style={{ fontSize: "11px", fontFamily: MONO, textAlign: "right", color: surpriseColor }}>{surpriseText}</span>
    </div>
  );
}

export function EarningsPageClient({ events, notice, source, watchlistSymbols = [] }: EarningsPageClientProps) {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<Filter>("upcoming");

  usePublishAssistantContext({ page: "dashboard/earnings" });
  const today = localTodayIso();
  const weekMon = mondayOfWeekContaining(today);
  const weekFri = fridayOfSameWeek(weekMon);

  const watchlistSet = useMemo(() => new Set(watchlistSymbols.map((s) => s.trim().toUpperCase())), [watchlistSymbols]);

  const filtered = useMemo(() => {
    const merged = [...events];
    if (filter === "upcoming") return merged.filter((e) => e.report_date >= today);
    if (filter === "today") return merged.filter((e) => e.report_date === today);
    if (filter === "week") {
      return merged.filter((e) => e.report_date >= today && e.report_date >= weekMon && e.report_date <= weekFri);
    }
    return merged;
  }, [events, filter, today, weekMon, weekFri]);

  const groups = useMemo(() => buildDateGroups(filtered), [filtered]);

  const rowCount = filtered.length;
  const filterIds: { id: Filter; label: string }[] = [
    { id: "upcoming", label: "Upcoming" },
    { id: "today", label: "Today" },
    { id: "week", label: "This week" },
    { id: "all", label: "All" }
  ];

  const emptyCopy =
    filter === "today"
      ? "No earnings reports scheduled for today."
      : filter === "upcoming"
        ? "No upcoming earnings in the next 30 days."
        : filter === "week"
          ? "No earnings reports this week."
          : "No earnings to display.";

  return (
    <section style={{ display: "grid", gap: spacing[4], maxWidth: 1120, margin: "0 auto", width: "100%" }}>
      <article
        className={surfaceGlowClassName}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.xl,
          padding: spacing[4]
        }}
      >
        <div style={{ marginBottom: spacing[3] }}>
          <h2 style={{ margin: 0, fontSize: typography.scale.lg, fontWeight: 700 }}>Earnings calendar</h2>
          <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.sm, color: colors.textMuted }}>
            US market · next 30 days
            {source && SOURCE_LABELS[source] ? ` · ${SOURCE_LABELS[source]}` : ""}
            {rowCount > 0 ? ` · ${rowCount} report${rowCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>

        <div
          style={{
            display: "inline-flex",
            gap: 2,
            padding: 4,
            borderRadius: borderRadius.lg,
            background: colors.surfaceMuted,
            border: `1px solid ${colors.border}`,
            flexWrap: "wrap"
          }}
        >
          {filterIds.map(({ id, label }) => {
            const active = filter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                style={{
                  borderRadius: borderRadius.md,
                  border: active ? `1px solid ${colors.border}` : "1px solid transparent",
                  background: active ? colors.surface : "transparent",
                  color: active ? colors.text : colors.textMuted,
                  padding: "8px 16px",
                  cursor: "pointer",
                  fontSize: typography.scale.sm,
                  fontWeight: active ? 600 : 500,
                  fontFamily: typography.fontFamilySans,
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,.06)" : "none"
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <EarningsLegend colors={colors} />

        {notice ? (
          <p
            role="status"
            style={{
              margin: `${spacing[3]} 0 0`,
              padding: spacing[3],
              borderRadius: borderRadius.lg,
              background: "rgba(245,158,11,.1)",
              border: `1px solid ${colors.caution}`,
              color: colors.text,
              fontSize: typography.scale.sm
            }}
          >
            {notice}
          </p>
        ) : null}

        {rowCount === 0 ? (
          <p style={{ margin: `${spacing[4]} 0 0`, padding: spacing[4], color: colors.textMuted, fontSize: typography.scale.sm }}>
            {emptyCopy}
          </p>
        ) : (
          <div style={{ display: "grid", gap: spacing[4], marginTop: spacing[4] }}>
            {groups.map((g) => {
              const isToday = g.reportDate === today;
              const header = formatEarningsGroupHeader(g.reportDate, today);
              const count = g.rows.length;
              return (
                <section
                  key={g.key}
                  style={{
                    borderRadius: borderRadius.lg,
                    border: `1px solid ${isToday ? `color-mix(in srgb, ${colors.accent} 35%, ${colors.border})` : colors.border}`,
                    background: isToday
                      ? `color-mix(in srgb, ${colors.accent} 6%, ${colors.background})`
                      : colors.background,
                    overflow: "hidden"
                  }}
                >
                  <header
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: spacing[2],
                      padding: `${spacing[3]} ${spacing[3]} ${spacing[2]}`,
                      borderBottom: `1px solid ${colors.border}`
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "1.5px",
                        color: colors.text,
                        fontWeight: 700
                      }}
                    >
                      {header}
                    </h3>
                    <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, whiteSpace: "nowrap" }}>
                      {count} reporting
                    </span>
                  </header>
                  <div style={{ overflowX: "auto" }}>
                    <div style={{ minWidth: 560 }}>
                      <TableHeader colors={colors} />
                      {g.rows.map((row, idx) => (
                        <EarningsRow
                          key={`${row.symbol}-${row.report_date}-${idx}`}
                          row={row}
                          today={today}
                          colors={colors}
                          onWatchlist={watchlistSet.has(row.symbol.trim().toUpperCase())}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <p
          style={{
            margin: `${spacing[4]} 0 0`,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            textAlign: "center",
            lineHeight: typography.lineHeight.normal
          }}
        >
          Scheduled reports show actual EPS after the report date. Beat/miss uses estimate vs reported EPS when both are
          available.
        </p>
      </article>
    </section>
  );
}
