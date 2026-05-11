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
