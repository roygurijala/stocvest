import { describe, expect, test } from "vitest";

import type { SnapshotPayload } from "@/lib/api/market";
import {
  dedupeWatchlistSymbolsUpper,
  formatWatchlistMaturationLabel,
  normalizeWatchlistMaturationBySymbol,
  pickWatchlistMaturationForPlan,
  parseCompanyNameFromTickerCandidateLabel,
  watchlistQuoteFromSnapshot,
  watchlistSymbolMatchesSearch
} from "@/lib/watchlist-page-utils";

describe("dedupeWatchlistSymbolsUpper", () => {
  test("preserves first occurrence order and uppercases", () => {
    expect(dedupeWatchlistSymbolsUpper(["aapl", " msft ", "AAPL", "nvda"])).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  test("drops empty tokens", () => {
    expect(dedupeWatchlistSymbolsUpper(["", "  ", "SPY"])).toEqual(["SPY"]);
  });

  test("empty input", () => {
    expect(dedupeWatchlistSymbolsUpper([])).toEqual([]);
  });
});

describe("parseCompanyNameFromTickerCandidateLabel", () => {
  test("parses em-dash label", () => {
    expect(parseCompanyNameFromTickerCandidateLabel("TSLA — Tesla, Inc.", "TSLA")).toBe("Tesla, Inc.");
  });

  test("parses hyphen label", () => {
    expect(parseCompanyNameFromTickerCandidateLabel("AAPL - Apple Inc.", "AAPL")).toBe("Apple Inc.");
  });

  test("ticker-only label", () => {
    expect(parseCompanyNameFromTickerCandidateLabel("TSLA", "TSLA")).toBe("");
  });

  test("wrong prefix", () => {
    expect(parseCompanyNameFromTickerCandidateLabel("MSFT — Microsoft", "TSLA")).toBe("");
  });
});

describe("formatWatchlistMaturationLabel", () => {
  test("prefers label over state and replaces underscores", () => {
    expect(formatWatchlistMaturationLabel({ label: "foo_bar", state: "actionable" })).toBe("foo bar");
  });

  test("falls back to state", () => {
    expect(formatWatchlistMaturationLabel({ state: "re_evaluating" })).toBe("re evaluating");
  });

  test("empty row", () => {
    expect(formatWatchlistMaturationLabel(undefined)).toBe("—");
    expect(formatWatchlistMaturationLabel({})).toBe("—");
  });
});

describe("normalizeWatchlistMaturationBySymbol", () => {
  test("reads by_symbol snake_case", () => {
    const out = normalizeWatchlistMaturationBySymbol({
      by_symbol: {
        aapl: { state: "developing", readiness_label: "Warm" }
      }
    });
    expect(out.AAPL).toEqual({ state: "developing", readiness_label: "Warm" });
  });

  test("reads legacy bySymbol and readinessLabel", () => {
    const out = normalizeWatchlistMaturationBySymbol({
      bySymbol: {
        MSFT: { label: "L", readinessLabel: "R" }
      }
    });
    expect(out.MSFT).toEqual({ label: "L", readiness_label: "R" });
  });

  test("skips rows with neither state nor label", () => {
    expect(
      normalizeWatchlistMaturationBySymbol({
        by_symbol: { X: { readiness_label: "only" } }
      })
    ).toEqual({});
  });

  test("non-object payload", () => {
    expect(normalizeWatchlistMaturationBySymbol(null)).toEqual({});
    expect(normalizeWatchlistMaturationBySymbol("x")).toEqual({});
  });
});

const snap = (over: Partial<SnapshotPayload> = {}): SnapshotPayload => ({
  symbol: "AAPL",
  ...over
});

describe("watchlistSymbolMatchesSearch", () => {
  const ms = { state: "actionable", readiness_label: "swing-ready" };
  const md = { state: "developing", readiness_label: "day-warm" };

  test("blank query matches", () => {
    expect(watchlistSymbolMatchesSearch("AAPL", "  ", "swing", false, undefined, ms, md)).toBe(true);
  });

  test("matches ticker substring case-insensitively", () => {
    expect(watchlistSymbolMatchesSearch("AAPL", "aap", "swing", true, undefined, ms, md)).toBe(true);
  });

  test("matches company name from snapshot", () => {
    const s = snap({ company_name: "Apple Inc." });
    expect(watchlistSymbolMatchesSearch("AAPL", "apple", "both", true, s, ms, md)).toBe(true);
  });

  test("matches company via fallback when snapshot has no name", () => {
    expect(watchlistSymbolMatchesSearch("TSLA", "tesla", "swing", false, snap(), ms, md, "Tesla, Inc.")).toBe(true);
  });

  test("swing mode searches swing maturation blob", () => {
    expect(watchlistSymbolMatchesSearch("AAPL", "swing-ready", "swing", true, snap(), ms, md)).toBe(true);
    expect(watchlistSymbolMatchesSearch("AAPL", "day-warm", "swing", true, snap(), ms, md)).toBe(false);
  });

  test("day mode with dual desk searches day blob only", () => {
    expect(watchlistSymbolMatchesSearch("AAPL", "day-warm", "day", true, snap(), ms, md)).toBe(true);
    expect(watchlistSymbolMatchesSearch("AAPL", "swing-ready", "day", true, snap(), ms, md)).toBe(false);
  });

  test("both + dual desk: maturation text ignored unless ticker/company match", () => {
    expect(watchlistSymbolMatchesSearch("AAPL", "swing-ready", "both", true, snap(), ms, md)).toBe(false);
    expect(watchlistSymbolMatchesSearch("AAPL", "day-warm", "both", true, snap(), ms, md)).toBe(false);
    expect(watchlistSymbolMatchesSearch("AAPL", "aapl", "both", true, snap(), ms, md)).toBe(true);
  });

  test("both + single desk uses swing maturation search", () => {
    expect(watchlistSymbolMatchesSearch("AAPL", "swing-ready", "both", false, snap(), ms, md)).toBe(true);
  });
});

describe("watchlistQuoteFromSnapshot", () => {
  test("null snapshot", () => {
    expect(watchlistQuoteFromSnapshot(undefined)).toBeNull();
  });

  test("prefers last_trade_price over day_close", () => {
    expect(
      watchlistQuoteFromSnapshot(
        snap({ last_trade_price: 10.5, day_close: 9, change_percent: 1.234 })
      )
    ).toEqual({ price: "$10.50", pct: "+1.23%", bullish: true });
  });

  test("falls back to day_close when no last", () => {
    expect(
      watchlistQuoteFromSnapshot(snap({ last_trade_price: undefined, day_close: 100, change_percent: -0.5 }))
    ).toEqual({ price: "$100.00", pct: "-0.50%", bullish: false });
  });

  test("zero change percent: pct present, bullish null", () => {
    expect(watchlistQuoteFromSnapshot(snap({ last_trade_price: 1, change_percent: 0 }))).toEqual({
      price: "$1.00",
      pct: "+0.00%",
      bullish: null
    });
  });

  test("no numeric price", () => {
    expect(watchlistQuoteFromSnapshot(snap({ last_trade_price: NaN, day_close: null }))).toBeNull();
  });
});

describe("pickWatchlistMaturationForPlan", () => {
  test("both view prefers desk with newer last_evaluated_at", () => {
    const swing = { state: "developing", last_evaluated_at: "2026-05-18T10:00:00Z", layers_aligned: 2 };
    const day = { state: "near_ready", last_evaluated_at: "2026-05-19T12:00:00Z", layers_aligned: 4 };
    expect(pickWatchlistMaturationForPlan("both", swing, day)).toBe(day);
    expect(pickWatchlistMaturationForPlan("both", day, swing)).toBe(day);
  });

  test("single-desk view uses that desk row", () => {
    const swing = { state: "developing", layers_aligned: 2 };
    const day = { state: "near_ready", layers_aligned: 4 };
    expect(pickWatchlistMaturationForPlan("swing", swing, day)).toBe(swing);
    expect(pickWatchlistMaturationForPlan("day", swing, day)).toBe(day);
  });
});
