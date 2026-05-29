import { describe, expect, test } from "vitest";
import {
  earningsCompanyLabel,
  earningsImpactLevel,
  earningsShowsReportedActual,
  formatEarningsGroupHeader,
  formatEarningsReportDate,
  isHighMarketImpact
} from "@/lib/earnings-row-present";
import type { EarningsEvent } from "@/lib/api/earnings-types";

const row = (partial: Partial<EarningsEvent>): EarningsEvent => ({
  symbol: "DELL",
  company_name: "Dell Technologies Inc",
  report_date: "2026-06-03",
  report_time: "after_market",
  ...partial
});

describe("earningsShowsReportedActual", () => {
  test("hides actual for future report dates even when API sends epsActual", () => {
    expect(
      earningsShowsReportedActual(
        row({ report_date: "2026-06-10", actual_eps: 1.5 }),
        "2026-06-01"
      )
    ).toBe(false);
  });

  test("shows actual for past or same-day reports", () => {
    expect(earningsShowsReportedActual(row({ report_date: "2026-05-29", actual_eps: 1.2 }), "2026-05-29")).toBe(true);
  });
});

describe("earningsCompanyLabel", () => {
  test("prefers real company name over symbol", () => {
    expect(earningsCompanyLabel(row({ company_name: "Dell Technologies Inc" }))).toBe("Dell Technologies Inc");
  });

  test("falls back to symbol when name equals ticker", () => {
    expect(earningsCompanyLabel(row({ company_name: "DELL" }))).toBe("DELL");
  });
});

describe("formatEarningsReportDate", () => {
  test("formats readable report date", () => {
    expect(formatEarningsReportDate("2026-06-03")).toMatch(/Jun/);
  });
});

describe("formatEarningsGroupHeader", () => {
  test("prefixes today in header", () => {
    expect(formatEarningsGroupHeader("2026-05-29", "2026-05-29")).toMatch(/^TODAY ·/);
  });

  test("uses weekday for other dates", () => {
    expect(formatEarningsGroupHeader("2026-06-01", "2026-05-29")).toMatch(/^MON/);
  });
});

describe("earningsImpactLevel", () => {
  test("classifies mega-cap as high", () => {
    expect(earningsImpactLevel(250_000_000_000)).toBe("high");
    expect(isHighMarketImpact(row({ market_cap: 250_000_000_000 }))).toBe(true);
  });

  test("falls back to known mega-cap symbols", () => {
    expect(isHighMarketImpact(row({ symbol: "AAPL", market_cap: null }))).toBe(true);
  });
});
