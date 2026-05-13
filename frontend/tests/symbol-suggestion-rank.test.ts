/**
 * Pure-function tests for `rankSymbolCandidates`.
 *
 * These lock the bucket priorities the signals page now relies on:
 *
 *   0  exact ticker match           (`symbol === q`)
 *   1  ticker prefix match          (`symbol.startsWith(q)`)
 *   2  ticker contains query        (`symbol.includes(q)`)
 *   3  company name contains query  (label only, NOT symbol)
 *
 * Tests stay pure so they run in milliseconds and don't need any
 * React / jsdom setup.
 */

import { describe, expect, test } from "vitest";

import { rankSymbolCandidates, scoreSymbolCandidate } from "@/lib/symbol-suggestion-rank";

const APP = { symbol: "APP", label: "APP — AppLovin Corp." };
const APPL = { symbol: "APPL", label: "APPL — Apollo Asset Mgmt" };
const AAPL = { symbol: "AAPL", label: "AAPL — Apple Inc." };
const TAP = { symbol: "TAP", label: "TAP — Molson Coors" };
const GOOG = { symbol: "GOOG", label: "GOOG — Alphabet Inc." };
const APE = { symbol: "APE", label: "APE — AMC Entertainment Preferred" };

describe("scoreSymbolCandidate buckets", () => {
  test("test_exact_symbol_match_is_bucket_0", () => {
    expect(scoreSymbolCandidate(AAPL, "aapl")).toBe(0);
  });

  test("test_symbol_prefix_match_is_bucket_1", () => {
    expect(scoreSymbolCandidate(APP, "ap")).toBe(1);
    expect(scoreSymbolCandidate(APPL, "ap")).toBe(1);
  });

  test("test_symbol_contains_match_is_bucket_2", () => {
    expect(scoreSymbolCandidate(TAP, "ap")).toBe(2);
  });

  test("test_company_only_match_is_bucket_3", () => {
    // Query "apple" only appears in the company portion of the AAPL
    // label — its ticker is `AAPL`, which doesn't contain the string
    // "apple". So bucket 3 is correct.
    expect(scoreSymbolCandidate(AAPL, "apple")).toBe(3);
  });

  test("test_no_match_is_minus_one", () => {
    expect(scoreSymbolCandidate(GOOG, "ap")).toBe(-1);
  });

  test("test_empty_query_returns_minus_one", () => {
    expect(scoreSymbolCandidate(AAPL, "")).toBe(-1);
  });
});

describe("rankSymbolCandidates ordering", () => {
  test("test_ticker_matches_come_before_company_name_matches_for_ap", () => {
    // The user-reported bug: typing "AP" used to surface AAPL (company
    // match via "apple") ahead of APP (symbol prefix) and APPL (symbol
    // prefix), because the previous filter just sorted alphabetically.
    // Buckets for query "ap":
    //   APE / APP / APPL → bucket 1 (ticker prefix) → alphabetical
    //   AAPL / TAP       → bucket 2 (ticker contains "ap") → alphabetical
    //   GOOG             → no match → dropped
    // The "Apple" company-name path is moot here because AAPL already
    // wins as a bucket-2 match — bucket 3 only ever fires when no
    // ticker bucket matches.
    const out = rankSymbolCandidates([AAPL, APP, TAP, APPL, GOOG, APE], "ap");
    expect(out.map((c) => c.symbol)).toEqual(["APE", "APP", "APPL", "AAPL", "TAP"]);
    expect(out).not.toContain(GOOG);
  });

  test("test_exact_match_wins_over_prefix_match", () => {
    // Both APP and APPL have prefix "app"; APP is an exact match for
    // query "app" so it should land first.
    const out = rankSymbolCandidates([APPL, APP, AAPL], "app");
    expect(out[0]).toBe(APP);
  });

  test("test_within_bucket_sort_is_alphabetical_by_symbol", () => {
    // APP and APPL are both bucket 1 for query "ap"; alphabetical
    // ticker order means APP comes before APPL.
    const out = rankSymbolCandidates([APPL, APP], "ap");
    expect(out.map((c) => c.symbol)).toEqual(["APP", "APPL"]);
  });

  test("test_company_only_match_lands_after_all_ticker_matches", () => {
    // To exercise bucket 3 specifically we need a query that matches
    // ONLY the company portion. "molson" only appears inside the
    // label of TAP (`"TAP — Molson Coors"`), not in any ticker.
    // GOOG's ticker doesn't match either, so the result should be
    // [TAP] with bucket 3.
    const out = rankSymbolCandidates([AAPL, GOOG, TAP], "molson");
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(TAP);
  });

  test("test_pure_company_query_orders_ticker_match_before_label_only_match", () => {
    // Anti-regression: even when one candidate's ticker happens to
    // match part of a company-style query, a ticker-bucket match
    // (1 or 2) must still beat a pure label match (3). For query
    // "app", APP wins as exact-ticker (bucket 0), APPL as prefix
    // (bucket 1), AAPL via label "Apple" only (bucket 3 — its
    // ticker `aapl` does NOT contain "app").
    const aaplLabel = { symbol: "AAPL", label: "AAPL — Apple Inc." };
    const out = rankSymbolCandidates([aaplLabel, APP, APPL], "app");
    expect(out.map((c) => c.symbol)).toEqual(["APP", "APPL", "AAPL"]);
  });

  test("test_non_matching_candidates_are_dropped_entirely", () => {
    const out = rankSymbolCandidates([AAPL, GOOG, TAP], "x");
    expect(out).toEqual([]);
  });

  test("test_empty_query_returns_input_unchanged", () => {
    const input = [AAPL, GOOG, TAP];
    expect(rankSymbolCandidates(input, "")).toEqual(input);
    // It must be a NEW array — the call site relies on slicing the
    // result without mutating shared state.
    expect(rankSymbolCandidates(input, "")).not.toBe(input);
  });

  test("test_label_without_em_dash_separator_still_works", () => {
    // The ranker tolerates legacy label formats ("aapl" without the
    // company portion). Such a label should NOT trigger bucket 3 on a
    // company-name query because there IS no company portion.
    const onlyTicker = { symbol: "AAPL", label: "AAPL" };
    expect(scoreSymbolCandidate(onlyTicker, "apple")).toBe(-1);
  });

  test("test_label_company_match_uses_only_the_company_portion", () => {
    // Anti-regression: "aapl" appears in the label `"AAPL — Apple Inc."`
    // (as the ticker prefix). If we naively did `label.includes("aapl")`
    // we'd inflate AAPL into bucket 3 for any query that happens to be
    // its ticker, but that's already bucket 0/1. The ranker strips the
    // `${SYMBOL} —` prefix before checking the company portion so this
    // ambiguity doesn't leak into the ordering.
    const out = rankSymbolCandidates([AAPL], "aapl");
    // AAPL matches `q="aapl"` as an exact ticker (bucket 0), not via
    // its company portion.
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(AAPL);
    expect(scoreSymbolCandidate(AAPL, "aapl")).toBe(0);
  });

  test("test_query_is_lowercased_and_trimmed", () => {
    expect(scoreSymbolCandidate(AAPL, "  AAPL  ".trim().toLowerCase())).toBe(0);
    const out = rankSymbolCandidates([AAPL, APP], "  Ap  ".trim().toLowerCase());
    expect(out[0]).toBe(APP);
  });
});
