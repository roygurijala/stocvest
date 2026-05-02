"use client";

import { useMemo, useState } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { EarningsEvent } from "@/lib/api/earnings";

interface EarningsPageClientProps {
  events: EarningsEvent[];
  notice?: string | null;
}

type Filter = "upcoming" | "today" | "week" | "all";

const MONO = `'DM Mono', 'IBM Plex Mono', ${typography.fontFamilyMono}`;

function localTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday (YYYY-MM-DD) of the week containing `ref`, local calendar; week starts Monday. */
function mondayOfWeekContaining(refIso: string): string {
  const [y, mo, da] = refIso.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  const day = d.getDay(); // 0 Sun … 6 Sat
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

function formatMonthDayUpper(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const mon = dt.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${mon} ${d}`;
}

function timingShort(t: EarningsEvent["report_time"]): string {
  if (t === "before_market") return "BMO";
  if (t === "after_market") return "AMC";
  if (t === "during_market") return "DURING";
  return "TBD";
}

function sortRows(list: EarningsEvent[]): EarningsEvent[] {
  return [...list].sort((a, b) => a.report_date.localeCompare(b.report_date) || a.symbol.localeCompare(b.symbol));
}

function beatMissBarPercent(actual: number, est: number): { width: number; beat: boolean | null } {
  if (!Number.isFinite(est) || est === 0) return { width: 0, beat: null };
  const pct = ((actual - est) / Math.abs(est)) * 100;
  const width = Math.min(Math.abs(pct) * 2, 100);
  if (actual > est) return { width, beat: true };
  if (actual < est) return { width, beat: false };
  return { width: 0, beat: null };
}

type RowGroup = { key: string; label: string; rows: EarningsEvent[] };

function buildRowGroups(filter: Filter, source: EarningsEvent[], today: string, weekMon: string, weekFri: string): RowGroup[] {
  if (filter === "today") {
    const rows = sortRows(source);
    return rows.length ? [{ key: "today", label: "Today", rows }] : [];
  }

  if (filter === "week") {
    const rows = sortRows(source);
    const byDate = new Map<string, EarningsEvent[]>();
    for (const e of rows) {
      const list = byDate.get(e.report_date) ?? [];
      list.push(e);
      byDate.set(e.report_date, list);
    }
    const dates = [...byDate.keys()].sort();
    return dates.map((d) => ({
      key: d,
      label: formatSectionDate(d),
      rows: sortRows(byDate.get(d)!)
    }));
  }

  if (filter === "all") {
    const rows = sortRows(source);
    const byDate = new Map<string, EarningsEvent[]>();
    for (const e of rows) {
      const list = byDate.get(e.report_date) ?? [];
      list.push(e);
      byDate.set(e.report_date, list);
    }
    const dates = [...byDate.keys()].sort();
    return dates.map((d) => ({
      key: d,
      label: formatSectionDate(d),
      rows: sortRows(byDate.get(d)!)
    }));
  }

  // upcoming
  const rows = sortRows(source);
  const todayRows = rows.filter((r) => r.report_date === today);
  const weekRest = rows.filter((r) => r.report_date !== today && r.report_date >= weekMon && r.report_date <= weekFri);
  const beyond = rows.filter((r) => r.report_date !== today && !(r.report_date >= weekMon && r.report_date <= weekFri));
  const groups: RowGroup[] = [];
  if (todayRows.length) groups.push({ key: "g-today", label: "Today", rows: todayRows });
  if (weekRest.length) groups.push({ key: "g-week", label: "This Week", rows: weekRest });
  if (beyond.length) groups.push({ key: "g-upcoming", label: "Upcoming", rows: beyond });
  return groups;
}

export function EarningsPageClient({ events, notice }: EarningsPageClientProps) {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<Filter>("upcoming");
  const today = localTodayIso();
  const weekMon = mondayOfWeekContaining(today);
  const weekFri = fridayOfSameWeek(weekMon);

  const filtered = useMemo(() => {
    const merged = [...events];
    if (filter === "upcoming") {
      return merged.filter((e) => e.report_date >= today);
    }
    if (filter === "today") {
      return merged.filter((e) => e.report_date === today);
    }
    if (filter === "week") {
      return merged.filter((e) => e.report_date >= today && e.report_date >= weekMon && e.report_date <= weekFri);
    }
    return merged;
  }, [events, filter, today, weekMon, weekFri]);

  const groups = useMemo(
    () => buildRowGroups(filter, filtered, today, weekMon, weekFri),
    [filter, filtered, today, weekMon, weekFri]
  );

  const emptyCopy =
    filter === "today"
      ? "No earnings reports today."
      : filter === "upcoming"
        ? "No earnings in the next 30 days."
        : filter === "week"
          ? "No earnings reports this week."
          : "No earnings to display.";

  const showEmpty = filtered.length === 0;

  const filterIds: { id: Filter; label: string }[] = [
    { id: "upcoming", label: "Upcoming" },
    { id: "today", label: "Today" },
    { id: "week", label: "This Week" },
    { id: "all", label: "All" }
  ];

  const gridCols = "52px minmax(0,1fr) 60px 80px 80px 90px";

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: spacing[3],
          flexWrap: "wrap"
        }}
      >
        <span
          style={{
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "3px",
            color: colors.textMuted,
            fontFamily: typography.fontFamilySans
          }}
        >
          Earnings · 30 days
        </span>
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
                  border: `1px solid ${colors.border}`,
                  background: active ? colors.surfaceMuted : "transparent",
                  color: active ? colors.text : colors.textMuted,
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "1.5px",
                  fontFamily: typography.fontFamilySans,
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,.12)" : "none",
                  opacity: active ? 1 : 0.75,
                  transition: "background 0.1s ease, box-shadow 0.1s ease"
                }}
              >
                {label}
              </button>
            );
          })}
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

      <div style={{ minWidth: 0 }}>
        {showEmpty ? (
          <p
            style={{
              margin: 0,
              padding: spacing[4],
              color: colors.textMuted,
              fontSize: typography.scale.sm
            }}
          >
            {emptyCopy}
          </p>
        ) : (
          groups.map((g, gi) => (
            <div key={g.key} style={{ marginBottom: gi < groups.length - 1 ? spacing[5] : 0 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  gap: "0 8px",
                  alignItems: "center",
                  marginTop: gi > 0 ? "16px" : 0,
                  padding: "0 8px",
                  paddingBottom: spacing[2],
                  fontSize: "9px",
                  textTransform: "uppercase",
                  letterSpacing: "2px",
                  color: colors.textMuted,
                  fontFamily: typography.fontFamilySans,
                  borderBottom: `0.5px solid ${colors.border}`
                }}
              >
                <span>Symbol</span>
                <span>Company</span>
                <span>Time</span>
                <span style={{ textAlign: "right" }}>Est EPS</span>
                <span style={{ textAlign: "right" }}>Actual</span>
                <span style={{ textAlign: "right" }}>Surprise %</span>
              </div>
              <div
                style={{
                  marginTop: "16px",
                  marginBottom: "4px",
                  padding: "0 8px",
                  paddingBottom: spacing[2],
                  fontSize: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "2px",
                  color: "var(--color-text-tertiary)",
                  fontFamily: typography.fontFamilySans,
                  borderBottom: `0.5px solid ${colors.border}`
                }}
              >
                {g.label}
              </div>
              <div style={{ display: "grid", gap: spacing[1] }}>
                {g.rows.map((row, idx) => {
                  const est = row.estimated_eps;
                  const act = row.actual_eps;
                  const surprise = row.surprise_percent;
                  const isUpcoming = typeof act !== "number";
                  let bar: { width: number; beat: boolean | null } = { width: 0, beat: null };
                  if (!isUpcoming && typeof est === "number") {
                    bar = beatMissBarPercent(act, est);
                  }
                  const beatGreen = "#22c55e";
                  const missRed = "#ef4444";

                  let surpriseText = "—";
                  let surpriseColor = colors.textMuted;
                  if (typeof surprise === "number") {
                    surpriseText = `${surprise >= 0 ? "+" : ""}${surprise.toFixed(1)}%`;
                    surpriseColor = surprise >= 0 ? beatGreen : missRed;
                  }

                  let actualColor = colors.text;
                  if (!isUpcoming && typeof est === "number") {
                    if (act > est) actualColor = beatGreen;
                    else if (act < est) actualColor = missRed;
                  }

                  return (
                    <div
                      key={`${row.symbol}-${row.report_date}-${idx}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: gridCols,
                        gap: "0 8px",
                        alignItems: "center",
                        padding: "8px 8px",
                        borderRadius: "6px",
                        transition: "background 0.1s ease",
                        fontFamily: typography.fontFamilySans
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = colors.surfaceMuted + "66";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "var(--color-text-primary)",
                          letterSpacing: "0.5px"
                        }}
                      >
                        {row.symbol}
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          color: colors.textMuted,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          minWidth: 0
                        }}
                        title={row.company_name}
                      >
                        {row.company_name}
                      </span>
                      <span
                        style={{
                          fontSize: "10px",
                          textTransform: "uppercase",
                          color: colors.textMuted
                        }}
                      >
                        {timingShort(row.report_time)}
                      </span>
                      <span
                        style={{
                          fontSize: "12px",
                          fontFamily: MONO,
                          textAlign: "right",
                          color: colors.textMuted
                        }}
                      >
                        {typeof est === "number" ? est.toFixed(2) : "—"}
                      </span>
                      <div style={{ textAlign: "right", minWidth: 0, justifySelf: "stretch" }}>
                        {isUpcoming ? (
                          <span
                            style={{
                              display: "block",
                              width: "100%",
                              fontSize: "10px",
                              textTransform: "uppercase",
                              color: "var(--color-text-tertiary)",
                              fontFamily: MONO,
                              textAlign: "right"
                            }}
                          >
                            {formatMonthDayUpper(row.report_date)}
                          </span>
                        ) : (
                          <>
                            <span style={{ fontSize: "12px", fontFamily: MONO, color: actualColor, display: "block" }}>
                              {act.toFixed(2)}
                            </span>
                            {bar.beat !== null && bar.width > 0 ? (
                              <div
                                style={{
                                  marginTop: "4px",
                                  width: "100%",
                                  height: "2px",
                                  borderRadius: "1px",
                                  background: colors.border
                                }}
                              >
                                <div
                                  style={{
                                    width: `${bar.width}%`,
                                    height: "2px",
                                    borderRadius: "1px",
                                    background: bar.beat ? beatGreen : missRed,
                                    transition: "width 0.1s ease"
                                  }}
                                />
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                      <span style={{ fontSize: "11px", fontFamily: MONO, textAlign: "right", color: surpriseColor }}>
                        {surpriseText}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <p
          style={{
            margin: `${spacing[4]} 0 0`,
            padding: showEmpty ? `${spacing[2]} ${spacing[4]} 0` : `${spacing[3]} ${spacing[2]} 0`,
            textAlign: "center",
            fontSize: "12px",
            color: colors.textMuted,
            lineHeight: typography.lineHeight.normal
          }}
        >
          Showing earnings for the next 30 days. Updates daily before market open.
        </p>
      </div>
    </section>
  );
}
