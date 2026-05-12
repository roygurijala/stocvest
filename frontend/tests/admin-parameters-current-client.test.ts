/**
 * Tests for `frontend/lib/api/admin-parameters-current.ts` — the
 * read-only client behind the admin parameters page's "Current
 * SignalParameters" section.
 *
 * Pins:
 *
 * - Happy path returns the full payload with the opaque `parameters`
 *   record passed through unchanged.
 * - Auth-401 calls `surfaceAuthErrorIfAny` and returns `null`.
 * - Any non-2xx, network error, or malformed body collapses to `null`.
 * - Missing `parameters` defaults to an empty object so the page can
 *   render a graceful "no fields" state instead of crashing on
 *   `Object.entries(undefined)`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surfaceAuthErrorIfAny: vi.fn().mockResolvedValue(false)
}));

vi.mock("@/lib/auth/surface-auth-error", () => ({
  surfaceAuthErrorIfAny: mocks.surfaceAuthErrorIfAny
}));

import { fetchCurrentParameters } from "@/lib/api/admin-parameters-current";

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

const SAMPLE = {
  version: "1.0.5",
  created_at: "2026-05-10T00:00:00Z",
  notes: "promotion",
  parameters: {
    weights: { sector: 0.25, gap: 0.2 },
    thresholds: { rsi_overbought: 70 }
  }
};

describe("fetchCurrentParameters", () => {
  test("happy path returns parsed payload", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE));
    const result = await fetchCurrentParameters();
    expect(result?.version).toBe("1.0.5");
    expect(result?.parameters).toEqual(SAMPLE.parameters);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/stocvest/admin/parameters/current"
    );
  });

  test("missing parameters key defaults to empty object", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ version: "1.0", created_at: "", notes: "" })
    );
    const result = await fetchCurrentParameters();
    expect(result?.parameters).toEqual({});
  });

  test("401 surfaces auth and returns null", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    expect(await fetchCurrentParameters()).toBeNull();
    expect(mocks.surfaceAuthErrorIfAny).toHaveBeenCalled();
  });

  test("non-2xx returns null", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect(await fetchCurrentParameters()).toBeNull();
  });

  test("network error returns null", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await fetchCurrentParameters()).toBeNull();
  });

  test("malformed body returns null", async () => {
    fetchMock.mockResolvedValue(jsonResponse([1, 2, 3]));
    expect(await fetchCurrentParameters()).toBeNull();
  });
});
