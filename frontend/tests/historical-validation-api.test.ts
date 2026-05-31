/**
 * Tests for `frontend/lib/api/historical-validation.ts` — the D2 Phase 3b typed client.
 *
 * Locks in the BFF / backend contract from the React side so any drift between this
 * client and the upstream `GET /v1/signals/historical-validation/summary` handler
 * (`stocvest/api/handlers/signals.py`) is caught here before it can reach the UI:
 *
 * - The default fetch builds `?horizon=&from=&to=` and parses `{ summary, disclaimer, ... }`.
 * - `mode` / `symbol` are forwarded with the same vocabulary the backend expects
 *   (`swing|day` lowercase, ticker uppercased).
 * - `?by_version=true` is sent on the by-version fetcher and the response is parsed
 *   into a `{ __all__, v1, v2, ... }` map.
 * - `null` accuracy on the wire (the JSON-safe form of NaN) is preserved as `null` in
 *   the parsed `BucketStats` so the UI can render "—".
 * - 401 responses return `null` so the caller can show a calm "sign in" state.
 * - Malformed responses (missing `summary`, missing `__all__`, non-JSON body) also
 *   return `null` rather than crashing the dashboard.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surfaceAuthErrorIfAny: vi.fn().mockResolvedValue(false)
}));

vi.mock("@/lib/auth/surface-auth-error", () => ({
  surfaceAuthErrorIfAny: mocks.surfaceAuthErrorIfAny
}));

interface RecordedFetchCall {
  url: string;
  init?: RequestInit;
}

const fetchMock = vi.fn();

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  mocks.surfaceAuthErrorIfAny.mockReset().mockResolvedValue(false);
  global.fetch = fetchMock as unknown as typeof global.fetch;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) }
  });
}

const SAMPLE_SUMMARY = {
  horizon: "1h",
  overall: {
    total_signals: 3,
    correct: 2,
    incorrect: 1,
    neutral: 0,
    resolved: 3,
    accuracy: 2 / 3
  },
  by_decision: {
    actionable: { total_signals: 3, correct: 2, incorrect: 1, neutral: 0, resolved: 3, accuracy: 2 / 3 }
  },
  by_regime: {
    risk_on: { total_signals: 3, correct: 2, incorrect: 1, neutral: 0, resolved: 3, accuracy: 2 / 3 }
  },
  by_mode: {
    swing: { total_signals: 3, correct: 2, incorrect: 1, neutral: 0, resolved: 3, accuracy: 2 / 3 }
  },
  by_pattern: {
    swing_composite: { total_signals: 3, correct: 2, incorrect: 1, neutral: 0, resolved: 3, accuracy: 2 / 3 }
  },
  by_readiness: {
    high: { total_signals: 3, correct: 2, incorrect: 1, neutral: 0, resolved: 3, accuracy: 2 / 3 }
  },
  by_direction: {
    bullish: { total_signals: 3, correct: 2, incorrect: 1, neutral: 0, resolved: 3, accuracy: 2 / 3 }
  },
  by_environment: {
    normal: { total_signals: 2, correct: 1, incorrect: 1, neutral: 0, resolved: 2, accuracy: 0.5 }
  },
  rows_examined: 3,
  parameter_versions: ["v1"]
};

const HORIZON_1H_PARAMS = {
  horizon: "1h" as const,
  from: "2026-04-01T00:00:00.000Z",
  to: "2026-05-01T00:00:00.000Z"
};

function lastFetchCall(): RecordedFetchCall {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: call[1] as RequestInit | undefined };
}

// ── fetchHistoricalValidationSummary ───────────────────────────────────────────────

describe("fetchHistoricalValidationSummary", () => {
  test("builds the correct query string and parses a happy-path response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        horizon: "1h",
        from: HORIZON_1H_PARAMS.from,
        to: HORIZON_1H_PARAMS.to,
        mode: null,
        symbol: null,
        disclaimer: "Historical signal accuracy does not guarantee future results.",
        summary: SAMPLE_SUMMARY
      })
    );

    const { fetchHistoricalValidationSummary } = await import("@/lib/api/historical-validation");
    const result = await fetchHistoricalValidationSummary(HORIZON_1H_PARAMS);

    const { url, init } = lastFetchCall();
    expect(url).toMatch(/^\/api\/stocvest\/signals\/historical-validation\/summary\?/);
    const qs = new URLSearchParams(url.split("?")[1] ?? "");
    expect(qs.get("horizon")).toBe("1h");
    expect(qs.get("from")).toBe(HORIZON_1H_PARAMS.from);
    expect(qs.get("to")).toBe(HORIZON_1H_PARAMS.to);
    expect(qs.has("by_version")).toBe(false);
    expect(init?.credentials).toBe("include");

    expect(result).not.toBeNull();
    expect(result!.disclaimer).toBe("Historical signal accuracy does not guarantee future results.");
    expect(result!.summary.overall.correct).toBe(2);
    expect(result!.summary.overall.accuracy).toBeCloseTo(2 / 3, 10);
    expect(result!.summary.parameter_versions).toEqual(["v1"]);
  });

  test("forwards mode and symbol with the right vocabulary", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        horizon: "1d",
        from: HORIZON_1H_PARAMS.from,
        to: HORIZON_1H_PARAMS.to,
        mode: "swing",
        symbol: "AAPL",
        disclaimer: "Historical signal accuracy does not guarantee future results.",
        summary: { ...SAMPLE_SUMMARY, horizon: "1d" }
      })
    );

    const { fetchHistoricalValidationSummary } = await import("@/lib/api/historical-validation");
    await fetchHistoricalValidationSummary({
      horizon: "1d",
      from: HORIZON_1H_PARAMS.from,
      to: HORIZON_1H_PARAMS.to,
      mode: "swing",
      // Lowercase ticker — client should uppercase before sending.
      symbol: "aapl"
    });

    const qs = new URLSearchParams(lastFetchCall().url.split("?")[1] ?? "");
    expect(qs.get("horizon")).toBe("1d");
    expect(qs.get("mode")).toBe("swing");
    expect(qs.get("symbol")).toBe("AAPL");
  });

  test("preserves null accuracy verbatim (so the UI renders an em-dash, not 0%)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        horizon: "1h",
        from: HORIZON_1H_PARAMS.from,
        to: HORIZON_1H_PARAMS.to,
        mode: null,
        symbol: null,
        disclaimer: "Historical signal accuracy does not guarantee future results.",
        summary: {
          ...SAMPLE_SUMMARY,
          overall: {
            total_signals: 0,
            correct: 0,
            incorrect: 0,
            neutral: 0,
            resolved: 0,
            accuracy: null
          },
          rows_examined: 0,
          parameter_versions: []
        }
      })
    );

    const { fetchHistoricalValidationSummary } = await import("@/lib/api/historical-validation");
    const result = await fetchHistoricalValidationSummary(HORIZON_1H_PARAMS);

    expect(result).not.toBeNull();
    expect(result!.summary.overall.accuracy).toBeNull();
    expect(result!.summary.parameter_versions).toEqual([]);
  });

  test("returns null on 401 and routes the response through the shared auth surface", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "unauthorized", message: "Authenticated user is required." }, { status: 401 })
    );

    const { fetchHistoricalValidationSummary } = await import("@/lib/api/historical-validation");
    const result = await fetchHistoricalValidationSummary(HORIZON_1H_PARAMS);

    expect(result).toBeNull();
    // surfaceAuthErrorIfAny handles the silent refresh + calm-banner fallback uniformly
    // across the codebase; the client must opt into that flow rather than rolling its own.
    expect(mocks.surfaceAuthErrorIfAny).toHaveBeenCalledTimes(1);
  });

  test("returns null when the response body lacks a parseable summary", async () => {
    // Backend handler is supposed to guarantee `summary` is present on the success
    // path; if a bug ever ships an empty body, the client must not crash the page.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ horizon: "1h", from: "x", to: "y", disclaimer: "x" })
    );

    const { fetchHistoricalValidationSummary } = await import("@/lib/api/historical-validation");
    const result = await fetchHistoricalValidationSummary(HORIZON_1H_PARAMS);

    expect(result).toBeNull();
  });

  test("returns null when the response is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("not json", { status: 200, headers: { "content-type": "text/plain" } })
    );

    const { fetchHistoricalValidationSummary } = await import("@/lib/api/historical-validation");
    const result = await fetchHistoricalValidationSummary(HORIZON_1H_PARAMS);

    expect(result).toBeNull();
  });
});

// ── fetchHistoricalValidationByVersion ─────────────────────────────────────────────

describe("fetchHistoricalValidationByVersion", () => {
  test("appends ?by_version=true and parses the per-version map including __all__", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        horizon: "1h",
        from: HORIZON_1H_PARAMS.from,
        to: HORIZON_1H_PARAMS.to,
        mode: null,
        symbol: null,
        disclaimer: "Historical signal accuracy does not guarantee future results.",
        by_parameter_version: {
          __all__: { ...SAMPLE_SUMMARY, parameter_versions: ["v1", "v2"] },
          v1: SAMPLE_SUMMARY,
          v2: {
            ...SAMPLE_SUMMARY,
            overall: { total_signals: 2, correct: 1, incorrect: 1, neutral: 0, resolved: 2, accuracy: 0.5 },
            parameter_versions: ["v2"]
          }
        }
      })
    );

    const { fetchHistoricalValidationByVersion } = await import("@/lib/api/historical-validation");
    const result = await fetchHistoricalValidationByVersion(HORIZON_1H_PARAMS);

    const qs = new URLSearchParams(lastFetchCall().url.split("?")[1] ?? "");
    expect(qs.get("by_version")).toBe("true");

    expect(result).not.toBeNull();
    expect(Object.keys(result!.by_parameter_version).sort()).toEqual(["__all__", "v1", "v2"]);
    expect(result!.by_parameter_version.v2.overall.accuracy).toBe(0.5);
    expect(result!.by_parameter_version.__all__.parameter_versions).toEqual(["v1", "v2"]);
  });

  test("returns null when the response is missing the __all__ aggregate bucket", async () => {
    // The backend always emits __all__ alongside per-version buckets. Missing it means
    // the contract is broken, so the client collapses to null rather than rendering a
    // partially-correct UI.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        horizon: "1h",
        from: HORIZON_1H_PARAMS.from,
        to: HORIZON_1H_PARAMS.to,
        mode: null,
        symbol: null,
        disclaimer: "Historical signal accuracy does not guarantee future results.",
        by_parameter_version: { v1: SAMPLE_SUMMARY }
      })
    );

    const { fetchHistoricalValidationByVersion } = await import("@/lib/api/historical-validation");
    const result = await fetchHistoricalValidationByVersion(HORIZON_1H_PARAMS);

    expect(result).toBeNull();
  });
});

// ── Display helpers ────────────────────────────────────────────────────────────────

describe("formatAccuracyPercent", () => {
  test('renders "—" for null accuracy so the UI never displays a misleading 0%', async () => {
    const { formatAccuracyPercent } = await import("@/lib/api/historical-validation");
    expect(formatAccuracyPercent(null)).toBe("—");
  });

  test("renders one decimal place for a finite accuracy in [0, 1]", async () => {
    const { formatAccuracyPercent } = await import("@/lib/api/historical-validation");
    expect(formatAccuracyPercent(0.6666)).toBe("66.7%");
    expect(formatAccuracyPercent(1)).toBe("100.0%");
    expect(formatAccuracyPercent(0)).toBe("0.0%");
  });

  test('renders "—" for non-finite accuracy (defensive — backend should never emit it)', async () => {
    const { formatAccuracyPercent } = await import("@/lib/api/historical-validation");
    expect(formatAccuracyPercent(Number.NaN)).toBe("—");
    expect(formatAccuracyPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("buildTrailingWindow", () => {
  test("produces ISO-8601 strings with the correct day delta", async () => {
    const { buildTrailingWindow } = await import("@/lib/api/historical-validation");
    const { from, to } = buildTrailingWindow(30);
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    expect(Number.isFinite(fromMs)).toBe(true);
    expect(Number.isFinite(toMs)).toBe(true);
    const days = (toMs - fromMs) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(30, 5);
  });
});

// ── fetchPublicHistoricalValidationSummary (Phase 3c-1 public mirror) ──────────────

const PUBLIC_SAMPLE_RESPONSE = {
  horizon: "1d",
  from: "2026-02-09T00:00:00.000Z",
  to: "2026-05-10T00:00:00.000Z",
  mode: null,
  disclaimer: "Historical signal accuracy does not guarantee future results.",
  summary: {
    horizon: "1d",
    overall: { total_signals: 5, correct: 3, incorrect: 2, neutral: 0, resolved: 5, accuracy: 0.6 },
    by_mode: {
      swing: { total_signals: 3, correct: 2, incorrect: 1, neutral: 0, resolved: 3, accuracy: 2 / 3 },
      day: { total_signals: 2, correct: 1, incorrect: 1, neutral: 0, resolved: 2, accuracy: 0.5 }
    },
    rows_examined: 5
  }
};

describe("fetchPublicHistoricalValidationSummary", () => {
  test("hits the public API origin directly (no BFF) and parses the response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(PUBLIC_SAMPLE_RESPONSE));

    const { fetchPublicHistoricalValidationSummary } = await import(
      "@/lib/api/historical-validation"
    );
    const result = await fetchPublicHistoricalValidationSummary();

    const { url, init } = lastFetchCall();
    expect(url).toContain("/v1/signals/historical-validation/public-summary");
    // Must NOT route through the BFF — homepage visitors have no JWT cookie to forward.
    expect(url).not.toContain("/api/stocvest/");
    // No credentials are forwarded either; the public endpoint is fully anonymous.
    expect(init?.credentials).toBeUndefined();

    expect(result).not.toBeNull();
    expect(result!.summary.overall.accuracy).toBeCloseTo(0.6, 10);
    expect(result!.summary.by_mode.swing.accuracy).toBeCloseTo(2 / 3, 10);
    expect(result!.summary.rows_examined).toBe(5);
    expect(result!.disclaimer).toBe(
      "Historical signal accuracy does not guarantee future results."
    );
  });

  test("forwards optional horizon / mode / daysBack in the query string", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...PUBLIC_SAMPLE_RESPONSE,
        horizon: "1h",
        mode: "swing",
        summary: { ...PUBLIC_SAMPLE_RESPONSE.summary, horizon: "1h" }
      })
    );

    const { fetchPublicHistoricalValidationSummary } = await import(
      "@/lib/api/historical-validation"
    );
    await fetchPublicHistoricalValidationSummary({
      horizon: "1h",
      mode: "swing",
      daysBack: 30
    });

    const qs = new URLSearchParams(lastFetchCall().url.split("?")[1] ?? "");
    expect(qs.get("horizon")).toBe("1h");
    expect(qs.get("mode")).toBe("swing");
    expect(qs.get("from")).toBeTruthy();
    expect(qs.get("to")).toBeTruthy();
  });

  test("does NOT route 401s through surfaceAuthErrorIfAny (it is a public endpoint)", async () => {
    // Even on the unusual path where the public endpoint somehow returns 401 (e.g. an
    // upstream misconfiguration), there is no session to refresh — the homepage caller
    // must collapse to null rather than triggering the sliding-session refresh flow.
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, { status: 401 }));

    const { fetchPublicHistoricalValidationSummary } = await import(
      "@/lib/api/historical-validation"
    );
    const result = await fetchPublicHistoricalValidationSummary();

    expect(result).toBeNull();
    expect(mocks.surfaceAuthErrorIfAny).not.toHaveBeenCalled();
  });

  test("returns null on a non-200 response so the homepage renders a calm empty state", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "internal" }, { status: 500 }));

    const { fetchPublicHistoricalValidationSummary } = await import(
      "@/lib/api/historical-validation"
    );
    const result = await fetchPublicHistoricalValidationSummary();

    expect(result).toBeNull();
  });

  test("returns null when the response body is missing a parseable summary", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        horizon: "1d",
        from: "2026-02-09T00:00:00.000Z",
        to: "2026-05-10T00:00:00.000Z",
        disclaimer: "x"
        // no `summary` field
      })
    );

    const { fetchPublicHistoricalValidationSummary } = await import(
      "@/lib/api/historical-validation"
    );
    const result = await fetchPublicHistoricalValidationSummary();

    expect(result).toBeNull();
  });

  test("returns null when the response is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("not json", { status: 200, headers: { "content-type": "text/plain" } })
    );

    const { fetchPublicHistoricalValidationSummary } = await import(
      "@/lib/api/historical-validation"
    );
    const result = await fetchPublicHistoricalValidationSummary();

    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — cross-version diff helpers
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_A_HAPPY = {
  total_signals: 12,
  correct: 7,
  incorrect: 3,
  neutral: 2,
  resolved: 12,
  accuracy: 0.7 // 7 / (7 + 3)
};

const BUCKET_B_HAPPY = {
  total_signals: 15,
  correct: 9,
  incorrect: 3,
  neutral: 3,
  resolved: 15,
  accuracy: 0.75 // 9 / (9 + 3)
};

describe("diffBucketStats", () => {
  test("happy path subtracts B − A across accuracy and counts", async () => {
    const { diffBucketStats } = await import("@/lib/api/historical-validation");
    const delta = diffBucketStats(BUCKET_A_HAPPY, BUCKET_B_HAPPY);
    // 0.75 - 0.70 = 0.05 (5 percentage points)
    expect(delta.accuracyDelta).toBeCloseTo(0.05, 10);
    expect(delta.totalDelta).toBe(3);
    expect(delta.resolvedDelta).toBe(2); // (9+3) - (7+3)
    expect(delta.neutralDelta).toBe(1);
  });

  test("null accuracy on either side → null accuracyDelta (em-dash discipline)", async () => {
    const { diffBucketStats } = await import("@/lib/api/historical-validation");
    const aNullAcc = { ...BUCKET_A_HAPPY, accuracy: null };
    const bNullAcc = { ...BUCKET_B_HAPPY, accuracy: null };
    expect(diffBucketStats(aNullAcc, BUCKET_B_HAPPY).accuracyDelta).toBeNull();
    expect(diffBucketStats(BUCKET_A_HAPPY, bNullAcc).accuracyDelta).toBeNull();
    expect(diffBucketStats(aNullAcc, bNullAcc).accuracyDelta).toBeNull();
  });

  test("identical buckets produce all-zero deltas (sanity)", async () => {
    const { diffBucketStats } = await import("@/lib/api/historical-validation");
    const delta = diffBucketStats(BUCKET_A_HAPPY, BUCKET_A_HAPPY);
    expect(delta.accuracyDelta).toBe(0);
    expect(delta.totalDelta).toBe(0);
    expect(delta.resolvedDelta).toBe(0);
    expect(delta.neutralDelta).toBe(0);
  });

  test("missing-on-one-side bucket is treated as zero rows with null accuracy", async () => {
    // A stratum may exist in version A's data but not B's (a pattern family only the
    // new rules can produce, or vice versa). The diff must not crash — it should treat
    // the absent side as "zero rows, no accuracy" and surface that through the deltas.
    const { diffBucketStats } = await import("@/lib/api/historical-validation");
    const deltaBOnly = diffBucketStats(null, BUCKET_B_HAPPY);
    expect(deltaBOnly.accuracyDelta).toBeNull(); // A had null accuracy → no comparison
    expect(deltaBOnly.totalDelta).toBe(15);
    expect(deltaBOnly.resolvedDelta).toBe(12);
    expect(deltaBOnly.neutralDelta).toBe(3);

    const deltaAOnly = diffBucketStats(BUCKET_A_HAPPY, undefined);
    expect(deltaAOnly.accuracyDelta).toBeNull();
    expect(deltaAOnly.totalDelta).toBe(-12);
    expect(deltaAOnly.resolvedDelta).toBe(-10);
    expect(deltaAOnly.neutralDelta).toBe(-2);
  });

  test("flags small samples independently on each side", async () => {
    const { diffBucketStats, SMALL_SAMPLE_THRESHOLD } = await import(
      "@/lib/api/historical-validation"
    );
    // A is below threshold (correct + incorrect = 4 < 10), B is above (8 + 5 = 13).
    const aSmall = { total_signals: 5, correct: 3, incorrect: 1, neutral: 1, resolved: 5, accuracy: 0.75 };
    const bLarge = { total_signals: 15, correct: 8, incorrect: 5, neutral: 2, resolved: 15, accuracy: 8 / 13 };
    const delta = diffBucketStats(aSmall, bLarge);
    expect(delta.smallSampleA).toBe(true);
    expect(delta.smallSampleB).toBe(false);
    // Reversing flips the flags — small-sample is a property of the bucket, not the
    // side, so the function must consult B's own resolved count for smallSampleB.
    const reversed = diffBucketStats(bLarge, aSmall);
    expect(reversed.smallSampleA).toBe(false);
    expect(reversed.smallSampleB).toBe(true);
    // Sanity: the threshold constant is the documented `10` so any change to that
    // number is a deliberate, test-visible event.
    expect(SMALL_SAMPLE_THRESHOLD).toBe(10);
  });
});

describe("formatAccuracyDelta", () => {
  test("renders sign + percentage points for finite deltas", async () => {
    const { formatAccuracyDelta } = await import("@/lib/api/historical-validation");
    expect(formatAccuracyDelta(0.052)).toBe("+5.2pp");
    expect(formatAccuracyDelta(-0.031)).toBe("-3.1pp");
    expect(formatAccuracyDelta(0.1)).toBe("+10.0pp");
    expect(formatAccuracyDelta(-0.1)).toBe("-10.0pp");
  });

  test("renders 0.0pp for exact-zero deltas — never an em-dash (zero is a real measurement)", async () => {
    const { formatAccuracyDelta } = await import("@/lib/api/historical-validation");
    expect(formatAccuracyDelta(0)).toBe("0.0pp");
  });

  test("renders em-dash for null / NaN / Infinity (consistency with formatAccuracyPercent)", async () => {
    const { formatAccuracyDelta } = await import("@/lib/api/historical-validation");
    expect(formatAccuracyDelta(null)).toBe("—");
    expect(formatAccuracyDelta(Number.NaN)).toBe("—");
    expect(formatAccuracyDelta(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatAccuracyDelta(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  test("one-decimal precision is enforced (no trailing zeros beyond one decimal place)", async () => {
    const { formatAccuracyDelta } = await import("@/lib/api/historical-validation");
    expect(formatAccuracyDelta(0.123456)).toBe("+12.3pp");
    expect(formatAccuracyDelta(-0.001)).toBe("-0.1pp");
  });
});

describe("selectComparableVersions + defaultCompareSelection", () => {
  function summaryStub(): unknown {
    return {
      horizon: "1d",
      overall: { total_signals: 1, correct: 1, incorrect: 0, neutral: 0, resolved: 1, accuracy: 1 },
      by_decision: {},
      by_regime: {},
      by_mode: {},
      by_pattern: {},
      by_readiness: {},
      by_direction: {},
      rows_examined: 1,
      parameter_versions: []
    };
  }

  test("excludes the __all__ aggregate from selectable versions", async () => {
    const { selectComparableVersions, ALL_VERSIONS_KEY } = await import(
      "@/lib/api/historical-validation"
    );
    const map = {
      [ALL_VERSIONS_KEY]: summaryStub(),
      v1: summaryStub(),
      v2: summaryStub()
    } as unknown as Record<string, import("@/lib/api/historical-validation").HistoricalValidationSummary>;
    const versions = selectComparableVersions(map);
    expect(versions).toEqual(["v1", "v2"]);
    expect(versions).not.toContain("__all__");
  });

  test("sorts v<n> numerically, not lexicographically (v2 < v10, not v10 between v1 and v2)", async () => {
    const { selectComparableVersions } = await import("@/lib/api/historical-validation");
    const map = {
      v10: summaryStub(),
      v2: summaryStub(),
      v1: summaryStub()
    } as unknown as Record<string, import("@/lib/api/historical-validation").HistoricalValidationSummary>;
    expect(selectComparableVersions(map)).toEqual(["v1", "v2", "v10"]);
  });

  test("always places `unknown` last so legacy rows are an explicit choice, never a default", async () => {
    const { selectComparableVersions, defaultCompareSelection } = await import(
      "@/lib/api/historical-validation"
    );
    const map = {
      unknown: summaryStub(),
      v1: summaryStub(),
      v2: summaryStub()
    } as unknown as Record<string, import("@/lib/api/historical-validation").HistoricalValidationSummary>;
    expect(selectComparableVersions(map)).toEqual(["v1", "v2", "unknown"]);
    // The default selection picks the last two comparable — `unknown` is last, so the
    // default A=v2, B=unknown is the intentional "what did the new rules add over the
    // legacy unstamped baseline?" view. If we ever want a different default this test
    // is the canary.
    expect(defaultCompareSelection(map)).toEqual({ versionA: "v2", versionB: "unknown" });
  });

  test("defaultCompareSelection returns null when fewer than two comparable versions exist", async () => {
    const { defaultCompareSelection, ALL_VERSIONS_KEY } = await import(
      "@/lib/api/historical-validation"
    );
    // Only __all__ + one version → no diff possible.
    const single = {
      [ALL_VERSIONS_KEY]: summaryStub(),
      v1: summaryStub()
    } as unknown as Record<string, import("@/lib/api/historical-validation").HistoricalValidationSummary>;
    expect(defaultCompareSelection(single)).toBeNull();
    // Empty map → null.
    expect(defaultCompareSelection({})).toBeNull();
  });

  test("defaultCompareSelection picks the last two versions (latest-pair-of-changes lens)", async () => {
    const { defaultCompareSelection } = await import("@/lib/api/historical-validation");
    const map = {
      v1: summaryStub(),
      v2: summaryStub(),
      v3: summaryStub()
    } as unknown as Record<string, import("@/lib/api/historical-validation").HistoricalValidationSummary>;
    expect(defaultCompareSelection(map)).toEqual({ versionA: "v2", versionB: "v3" });
  });
});
