"use client";

import { useMemo, useState } from "react";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import type { EarningsEvent } from "@/lib/api/earnings";
import {
  earningsCompanyLabel,
  earningsShowsReportedActual,
  earningsTimingLabel,
  formatEarningsReportDate
} from "@/lib/earnings-row-present";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

interface EarningsPageClientProps {
  events: EarningsEvent[];
  notice?: string | null;
  source?: string | null;
}

type Filter = "upcoming" | "today" | "week" | "all";

const MONO = `'DM Mono', 'IBM Plex Mono', ${typography.fontFamilyMono}`;

/** Shared column template — header and rows must match exactly. */
const TABLE_GRID =
  "minmax(3.5rem,4.5rem) minmax(8rem,1.6fr) minmax(5.5rem,6.5rem) 2.75rem minmax(3.5rem,4.25rem) minmax(3.5rem,4.25rem) minmax(3.75rem,4.5rem)";

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

function formatSectionDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function sortRows(list: EarningsEvent[]): EarningsEvent[] {
  return [...list].sort((a, b) => a.report_date.localeCompare(b.report_date) || a.symbol.localeCompare(b.symbol));
}

type RowGroup = { key: string; label: string; rows: EarningsEvent[] };

function buildRowGroups(filter: Filter, source: EarningsEvent[], today: string, weekMon: string, weekFri: string): RowGroup[] {
  if (filter === "today") {
    const rows = sortRows(source);
    return rows.length ? [{ key: "today", label: "Today", rows }] : [];
  }

  if (filter === "week" || filter === "all") {
    const rows = sortRows(source);
    const byDate = new Map<string, EarningsEvent[]>();
    for (const e of rows) {
      const list = byDate.get(e.report_date) ?? [];
      list.push(e);
      byDate.set(e.report_date, list);
    }
    return [...byDate.keys()].sort().map((d) => ({
      key: d,
      label: filter === "week" ? formatSectionDate(d) : formatSectionDate(d),
      rows: sortRows(byDate.get(d)!)
    }));
  }

  const rows = sortRows(source);
  const todayRows = rows.filter((r) => r.report_date === today);
  const weekRest = rows.filter((r) => r.report_date !== today && r.report_date >= weekMon && r.report_date <= weekFri);
  const beyond = rows.filter((r) => r.report_date !== today && !(r.report_date >= weekMon && r.report_date <= weekFri));
  const groups: RowGroup[] = [];
  if (todayRows.length) groups.push({ key: "g-today", label: "Today", rows: todayRows });
  if (weekRest.length) groups.push({ key: "g-week", label: "This Week", rows: weekRest });
  if (beyond.length) groups.push({ key: "g-upcoming", label: "Later", rows: beyond });
  return groups;
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
      <span>Company</span>
      <span>Report</span>
      <span>Time</span>
      <span style={{ textAlign: "right" }}>Est EPS</span>
      <span style={{ textAlign: "right" }}>Actual</span>
      <span style={{ textAlign: "right" }}>Surprise</span>
    </div>
  );
}

function EarningsRow({
  row,
  today,
  colors
}: {
  row: EarningsEvent;
  today: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const est = row.estimated_eps;
  const reported = earningsShowsReportedActual(row, today);
  const act = reported && typeof row.actual_eps === "number" ? row.actual_eps : null;
  const surprise = reported && typeof row.surprise_percent === "number" ? row.surprise_percent : null;
  const beatGreen = colors.bullish;
  const missRed = colors.bearish;

  let surpriseText = "—";
  let surpriseColor = colors.textMuted;
  if (surprise !== null) {
    surpriseText = `${surprise >= 0 ? "+" : ""}${surprise.toFixed(1)}%`;
    surpriseColor = surprise >= 0 ? beatGreen : missRed;
  }

  let actualColor = colors.text;
  let actualText = "—";
  if (act !== null) {
    actualText = act.toFixed(2);
    if (typeof est === "number") {
      if (act > est) actualColor = beatGreen;
      else if (act < est) actualColor = missRed;
    }
  }

  const company = earningsCompanyLabel(row);

  return (
    <div
      role="row"
      className="earnings-table-row"
      style={{
        display: "grid",
        gridTemplateColumns: TABLE_GRID,
        columnGap: spacing[3],
        alignItems: "center",
        padding: `${spacing[2]} ${spacing[3]}`,
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
      <span style={{ fontSize: typography.scale.sm, fontWeight: 700, letterSpacing: "0.04em" }}>{row.symbol}</span>
      <span
        style={{
          fontSize: typography.scale.sm,
          color: colors.textMuted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0
        }}
        title={company}
      >
        {company}
      </span>
      <span style={{ fontSize: "11px", color: colors.textMuted, whiteSpace: "nowrap" }}>
        {formatEarningsReportDate(row.report_date)}
      </span>
      <span style={{ fontSize: "10px", fontWeight: 600, color: colors.textMuted }}>{earningsTimingLabel(row.report_time)}</span>
      <span style={{ fontSize: typography.scale.sm, fontFamily: MONO, textAlign: "right", color: colors.textMuted }}>
        {typeof est === "number" ? est.toFixed(2) : "—"}
      </span>
      <span style={{ fontSize: typography.scale.sm, fontFamily: MONO, textAlign: "right", color: actualColor }}>{actualText}</span>
      <span style={{ fontSize: "11px", fontFamily: MONO, textAlign: "right", color: surpriseColor }}>{surpriseText}</span>
    </div>
  );
}

export function EarningsPageClient({ events, notice, source }: EarningsPageClientProps) {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<Filter>("upcoming");

  usePublishAssistantContext({ page: "dashboard/earnings" });
  const today = localTodayIso();
  const weekMon = mondayOfWeekContaining(today);
  const weekFri = fridayOfSameWeek(weekMon);

  const filtered = useMemo(() => {
    const merged = [...events];
    if (filter === "upcoming") return merged.filter((e) => e.report_date >= today);
    if (filter === "today") return merged.filter((e) => e.report_date === today);
    if (filter === "week") {
      return merged.filter((e) => e.report_date >= today && e.report_date >= weekMon && e.report_date <= weekFri);
    }
    return merged;
  }, [events, filter, today, weekMon, weekFri]);

  const groups = useMemo(
    () => buildRowGroups(filter, filtered, today, weekMon, weekFri),
    [filter, filtered, today, weekMon, weekFri]
  );

  const rowCount = filtered.length;
  const filterIds: { id: Filter; label: string }[] = [
    { id: "upcoming", label: "Upcoming" },
    { id: "today", label: "Today" },
    { id: "week", label: "This Week" },
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: spacing[3],
            flexWrap: "wrap",
            marginBottom: spacing[3]
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: typography.scale.lg, fontWeight: 700 }}>Earnings calendar</h2>
            <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.sm, color: colors.textMuted }}>
              US market · next 30 days
              {source && SOURCE_LABELS[source] ? ` · ${SOURCE_LABELS[source]}` : ""}
              {rowCount > 0 ? ` · ${rowCount} report${rowCount === 1 ? "" : "s"}` : ""}
            </p>
          </div>
          <div style={{ display: "inline-flex", gap: spacing[2], flexWrap: "wrap" }}>
            {filterIds.map(({ id, label }) => {
              const active = filter === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  style={{
                    borderRadius: borderRadius.full,
                    border: `1px solid ${active ? colors.accent : colors.border}`,
                    background: active ? colors.surfaceMuted : "transparent",
                    color: active ? colors.text : colors.textMuted,
                    padding: "6px 14px",
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: active ? 600 : 500,
                    textTransform: "uppercase",
                    letterSpacing: "1px",
                    fontFamily: typography.fontFamilySans
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {notice ? (
          <p
            role="status"
            style={{
              margin: `0 0 ${spacing[3]}`,
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
          <p style={{ margin: 0, padding: spacing[4], color: colors.textMuted, fontSize: typography.scale.sm }}>{emptyCopy}</p>
        ) : (
          <div style={{ display: "grid", gap: spacing[4] }}>
            {groups.map((g) => (
              <div key={g.key}>
                <h3
                  style={{
                    margin: `0 0 ${spacing[2]}`,
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "2px",
                    color: colors.textMuted,
                    fontWeight: 600
                  }}
                >
                  {g.label}
                  <span style={{ marginLeft: spacing[2], fontWeight: 500, opacity: 0.8 }}>({g.rows.length})</span>
                </h3>
                <div
                  style={{
                    borderRadius: borderRadius.lg,
                    border: `1px solid ${colors.border}`,
                    overflowX: "auto",
                    background: colors.background
                  }}
                >
                  <div style={{ minWidth: 640 }}>
                    <TableHeader colors={colors} />
                    {g.rows.map((row, idx) => (
                      <EarningsRow key={`${row.symbol}-${row.report_date}-${idx}`} row={row} today={today} colors={colors} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
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
