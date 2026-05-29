import { describe, expect, test } from "vitest";
import {
  dedupeEarningsEvents,
  earningsFilterScopeLabel,
  filterEarningsByTab,
  mondayOfWeekContaining
} from "@/lib/earnings-filters";
import type { EarningsEvent } from "@/lib/api/earnings-types";

const ev = (symbol: string, report_date: string): EarningsEvent => ({
  symbol,
  company_name: symbol,
  report_date,
  report_time: "unknown"
});

describe("filterEarningsByTab", () => {
  const rows = [
    ev("A", "2026-05-26"),
    ev("B", "2026-05-27"),
    ev("C", "2026-05-29"),
    ev("D", "2026-06-02")
  ];
  const today = "2026-05-29";

  test("today filter keeps only report_date === today", () => {
    expect(filterEarningsByTab(rows, "today", today).map((r) => r.symbol)).toEqual(["C"]);
  });

  test("week filter includes earlier days in the same Mon–Sun week", () => {
    expect(filterEarningsByTab(rows, "week", today).map((r) => r.symbol)).toEqual(["A", "B", "C"]);
  });

  test("week filter does not require report_date >= today", () => {
    const mon = mondayOfWeekContaining(today);
    expect(mon).toBe("2026-05-25");
    const week = filterEarningsByTab(rows, "week", today);
    expect(week.some((r) => r.report_date < today)).toBe(true);
  });

  test("upcoming filter is from today forward", () => {
    expect(filterEarningsByTab(rows, "upcoming", today).map((r) => r.symbol)).toEqual(["C", "D"]);
  });
});

describe("earningsFilterScopeLabel", () => {
  test("changes label for this week vs upcoming", () => {
    expect(earningsFilterScopeLabel("week", "2026-05-29", 30)).toMatch(/This week/);
    expect(earningsFilterScopeLabel("upcoming", "2026-05-29", 30)).toMatch(/From today/);
    expect(earningsFilterScopeLabel("week", "2026-05-29", 30)).not.toMatch(/next 30 days/i);
  });
});

describe("dedupeEarningsEvents", () => {
  test("drops duplicate symbol on same date", () => {
    const out = dedupeEarningsEvents([ev("AAPL", "2026-05-29"), ev("AAPL", "2026-05-29")]);
    expect(out).toHaveLength(1);
  });
});
