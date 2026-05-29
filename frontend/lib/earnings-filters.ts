import type { EarningsEvent } from "@/lib/api/earnings-types";

export type EarningsPageFilter = "upcoming" | "today" | "week" | "all";

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday of the ISO week containing `refIso` (local calendar). */
export function mondayOfWeekContaining(refIso: string): string {
  const d = parseLocalDate(refIso);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return formatIso(d);
}

export function addDaysIso(iso: string, delta: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + delta);
  return formatIso(d);
}

/** Sunday end of the Mon–Sun week that contains `mondayIso`. */
export function sundayOfWeekContaining(mondayIso: string): string {
  return addDaysIso(mondayIso, 6);
}

function formatShortDate(iso: string): string {
  const dt = parseLocalDate(iso);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Filter earnings rows for the active tab. */
export function filterEarningsByTab(
  events: readonly EarningsEvent[],
  filter: EarningsPageFilter,
  todayIso: string
): EarningsEvent[] {
  const weekMon = mondayOfWeekContaining(todayIso);
  const weekSun = sundayOfWeekContaining(weekMon);

  switch (filter) {
    case "upcoming":
      return events.filter((e) => e.report_date >= todayIso);
    case "today":
      return events.filter((e) => e.report_date === todayIso);
    case "week":
      return events.filter((e) => e.report_date >= weekMon && e.report_date <= weekSun);
    case "all":
      return [...events];
  }
}

/** Subtitle scope line — must match the active filter, not always “next 30 days”. */
export function earningsFilterScopeLabel(filter: EarningsPageFilter, todayIso: string, calendarDays: number): string {
  const weekMon = mondayOfWeekContaining(todayIso);
  const weekSun = sundayOfWeekContaining(weekMon);
  const weekRange = `${formatShortDate(weekMon)}–${formatShortDate(weekSun)}`;

  switch (filter) {
    case "upcoming":
      return `From today · ${calendarDays}-day feed`;
    case "today":
      return "Today only";
    case "week":
      return `This week · ${weekRange}`;
    case "all":
      return `${calendarDays}-day feed`;
  }
}

/** Dedupe symbol + report_date when merging upcoming + recent. */
export function dedupeEarningsEvents(events: readonly EarningsEvent[]): EarningsEvent[] {
  const seen = new Set<string>();
  const out: EarningsEvent[] = [];
  for (const e of events) {
    const key = `${e.symbol.trim().toUpperCase()}|${e.report_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
