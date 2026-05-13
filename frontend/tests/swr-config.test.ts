/**
 * Tier 1 → Layer 4 — SWR global config lock-in tests.
 *
 * See `docs/PERFORMANCE.md` §1 layer 4 + §4C.
 *
 * Why pin these defaults?
 *
 *   The `STOCVEST_SWR_DEFAULTS` values are load-bearing — each
 *   one was chosen with an explicit rationale documented inline
 *   in `lib/swr/config.ts`. A "harmless looking" change to one
 *   of them (e.g. bumping `dedupingInterval` to 5_000 because
 *   "30s feels too long") would silently invalidate the
 *   reasoning of every hook that depends on it (snapshot
 *   caching, mode-toggle dedupe, etc.). These tests force the
 *   author of that change to justify it in the PR review.
 *
 *   The `shouldRetryOnError` predicate in particular is safety-
 *   critical: retrying a 401 re-fires the session-expired banner
 *   for the user, which is the exact UX bug we fixed
 *   in the session-expiry PR. We never want to re-introduce it.
 */

import { describe, expect, test } from "vitest";

import {
  STOCVEST_SWR_CACHE_NS,
  STOCVEST_SWR_DEFAULTS
} from "@/lib/swr/config";

describe("STOCVEST_SWR_DEFAULTS", () => {
  test("disables focus revalidation (saves API budget on tab-switch)", () => {
    expect(STOCVEST_SWR_DEFAULTS.revalidateOnFocus).toBe(false);
  });

  test("enables reconnect revalidation (refresh after wifi blip)", () => {
    expect(STOCVEST_SWR_DEFAULTS.revalidateOnReconnect).toBe(true);
  });

  test("dedupes identical requests within 30 seconds", () => {
    expect(STOCVEST_SWR_DEFAULTS.dedupingInterval).toBe(30_000);
  });

  test("retries exactly once on error (5xx flakes only)", () => {
    expect(STOCVEST_SWR_DEFAULTS.errorRetryCount).toBe(1);
  });

  test("keeps previous data during symbol-switch transitions", () => {
    expect(STOCVEST_SWR_DEFAULTS.keepPreviousData).toBe(true);
  });

  test("namespace prefix is set", () => {
    expect(STOCVEST_SWR_CACHE_NS).toBe("stocvest:");
  });
});

describe("STOCVEST_SWR_DEFAULTS.shouldRetryOnError", () => {
  const predicate = STOCVEST_SWR_DEFAULTS.shouldRetryOnError;

  test("never retries on 401 (would re-surface session-expired banner)", () => {
    expect(predicate).toBeTypeOf("function");
    expect((predicate as (e: unknown) => boolean)({ status: 401 })).toBe(false);
  });

  test("retries on 5xx (genuinely transient)", () => {
    expect((predicate as (e: unknown) => boolean)({ status: 500 })).toBe(true);
    expect((predicate as (e: unknown) => boolean)({ status: 502 })).toBe(true);
    expect((predicate as (e: unknown) => boolean)({ status: 503 })).toBe(true);
  });

  test("retries on 4xx other than 401 (e.g. throttling)", () => {
    expect((predicate as (e: unknown) => boolean)({ status: 429 })).toBe(true);
    expect((predicate as (e: unknown) => boolean)({ status: 404 })).toBe(true);
  });

  test("retries on non-status errors (network errors, type errors, etc.)", () => {
    expect((predicate as (e: unknown) => boolean)(new Error("network"))).toBe(true);
    expect((predicate as (e: unknown) => boolean)(null)).toBe(true);
    expect((predicate as (e: unknown) => boolean)(undefined)).toBe(true);
    expect((predicate as (e: unknown) => boolean)({})).toBe(true);
  });
});
