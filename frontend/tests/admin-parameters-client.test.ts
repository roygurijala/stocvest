/**
 * Tests for `frontend/lib/api/admin-parameters.ts` — the D10 Phase 4
 * typed client for the admin parameter-rollback surface.
 *
 * The client is a thin layer over two BFF routes:
 *
 *   * `GET  /api/stocvest/admin/parameters/history`
 *   * `POST /api/stocvest/admin/parameters/rollback`
 *
 * Each BFF route proxies verbatim to the upstream backend handler. The
 * contract these tests pin:
 *
 * - `fetchParameterHistory` returns `null` on auth failure, malformed body,
 *   or any non-2xx response — never throws.
 * - `rollbackToVersion` returns a discriminated `{ kind: "ok" | "error" }`
 *   outcome carrying the upstream HTTP status + error envelope so the UI
 *   can map 404 / 409 / 500 to friendly text without re-parsing.
 * - Request body shape: `{ target_version: string }` with whitespace
 *   stripped client-side so the backend always receives a clean value.
 * - Auth-401 calls into `surfaceAuthErrorIfAny` so global session
 *   handling can refresh-or-expire.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surfaceAuthErrorIfAny: vi.fn().mockResolvedValue(false)
}));

vi.mock("@/lib/auth/surface-auth-error", () => ({
  surfaceAuthErrorIfAny: mocks.surfaceAuthErrorIfAny
}));

import {
  fetchParameterHistory,
  formatAccuracyBeforeChange,
  rollbackErrorLabel,
  rollbackToVersion
} from "@/lib/api/admin-parameters";

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

function lastCall(): { url: string; init?: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: call[1] as RequestInit | undefined };
}

const SAMPLE_HISTORY_ROW = {
  version: "1.0.5",
  created_at: "2026-05-10T00:00:00+00:00",
  reason: "promotion v1.0.5",
  changed_by: "d10-admin:alice",
  signal_count_on_change: 100,
  accuracy_before_change: 0.62,
  is_current_live_version: true
};

const SAMPLE_HISTORY_RESPONSE = {
  limit: 50,
  items: [
    SAMPLE_HISTORY_ROW,
    {
      version: "1.0.4",
      created_at: "2026-05-01T00:00:00+00:00",
      reason: "promotion v1.0.4",
      changed_by: "d10-admin:bob",
      signal_count_on_change: 95,
      accuracy_before_change: 0.6,
      is_current_live_version: false
    }
  ]
};

// ───────────────────────────────────────────────────────────────────────────
// fetchParameterHistory
// ───────────────────────────────────────────────────────────────────────────

describe("fetchParameterHistory", () => {
  test("happy path returns parsed items", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_HISTORY_RESPONSE));

    const response = await fetchParameterHistory();

    expect(response).not.toBeNull();
    expect(response!.limit).toBe(50);
    expect(response!.items).toHaveLength(2);
    expect(response!.items[0].version).toBe("1.0.5");
    expect(response!.items[0].is_current_live_version).toBe(true);
    expect(response!.items[1].is_current_live_version).toBe(false);
  });

  test("hits the BFF history route", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_HISTORY_RESPONSE));

    await fetchParameterHistory();

    const { url } = lastCall();
    expect(url).toBe("/api/stocvest/admin/parameters/history");
  });

  test("appends limit to the query string when provided", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_HISTORY_RESPONSE));

    await fetchParameterHistory({ limit: 20 });

    const { url } = lastCall();
    expect(url).toBe("/api/stocvest/admin/parameters/history?limit=20");
  });

  test("ignores zero and negative limit values", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_HISTORY_RESPONSE));

    await fetchParameterHistory({ limit: 0 });
    expect(lastCall().url).toBe("/api/stocvest/admin/parameters/history");

    await fetchParameterHistory({ limit: -10 });
    expect(lastCall().url).toBe("/api/stocvest/admin/parameters/history");
  });

  test("uses credentials include and cache no-store", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_HISTORY_RESPONSE));

    await fetchParameterHistory();

    const { init } = lastCall();
    expect(init?.credentials).toBe("include");
    expect(init?.cache).toBe("no-store");
    expect(init?.method).toBe("GET");
  });

  test("returns null and surfaces auth error on 401", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "expired" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    );

    const response = await fetchParameterHistory();

    expect(response).toBeNull();
    expect(mocks.surfaceAuthErrorIfAny).toHaveBeenCalledTimes(1);
  });

  test("returns null on 403", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "forbidden" }, { status: 403 })
    );
    const response = await fetchParameterHistory();
    expect(response).toBeNull();
  });

  test("returns null on 500", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "internal_error" }, { status: 500 })
    );
    const response = await fetchParameterHistory();
    expect(response).toBeNull();
  });

  test("returns null when body is not an object", async () => {
    fetchMock.mockResolvedValue(jsonResponse(["not", "an", "object"]));
    const response = await fetchParameterHistory();
    expect(response).toBeNull();
  });

  test("returns empty items when items field is missing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ limit: 10 }));
    const response = await fetchParameterHistory();
    expect(response).not.toBeNull();
    expect(response!.items).toEqual([]);
    expect(response!.limit).toBe(10);
  });

  test("filters out malformed history rows in the items array", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        limit: 50,
        items: [
          SAMPLE_HISTORY_ROW,
          { version: "" }, // empty version → dropped
          { not_a_version: 42 }, // missing version field → dropped
          null, // null → dropped
          {
            version: "1.0.3",
            created_at: "x",
            reason: "x",
            changed_by: "x",
            signal_count_on_change: 0,
            accuracy_before_change: 0,
            is_current_live_version: false
          }
        ]
      })
    );

    const response = await fetchParameterHistory();
    expect(response).not.toBeNull();
    expect(response!.items.map((r) => r.version)).toEqual(["1.0.5", "1.0.3"]);
  });

  test("returns null when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const response = await fetchParameterHistory();
    expect(response).toBeNull();
  });

  test("defaults limit to 50 when backend returns 0 or missing limit", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [SAMPLE_HISTORY_ROW] }));
    const response = await fetchParameterHistory();
    expect(response!.limit).toBe(50);
  });

  test("coerces non-finite numeric columns defensively", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        limit: 50,
        items: [
          {
            version: "1.0.3",
            created_at: "2026-05-01",
            reason: "r",
            changed_by: "alice",
            signal_count_on_change: "not a number",
            accuracy_before_change: NaN,
            is_current_live_version: false
          }
        ]
      })
    );
    const response = await fetchParameterHistory();
    expect(response!.items[0].signal_count_on_change).toBe(0);
    expect(response!.items[0].accuracy_before_change).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// rollbackToVersion
// ───────────────────────────────────────────────────────────────────────────

describe("rollbackToVersion", () => {
  test("happy path returns ok outcome with parsed result", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        target_version: "1.0.3",
        rolled_back_from: "1.0.5",
        new_parameter_version: "1.0.6",
        error: null,
        extras: { target_reason: "prior tuning iter" }
      })
    );

    const outcome = await rollbackToVersion("1.0.3");

    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.data.success).toBe(true);
      expect(outcome.data.target_version).toBe("1.0.3");
      expect(outcome.data.rolled_back_from).toBe("1.0.5");
      expect(outcome.data.new_parameter_version).toBe("1.0.6");
      expect(outcome.data.extras).toEqual({ target_reason: "prior tuning iter" });
    }
  });

  test("posts JSON body to the BFF rollback route", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        target_version: "1.0.3",
        rolled_back_from: "1.0.5",
        new_parameter_version: "1.0.6",
        error: null,
        extras: {}
      })
    );

    await rollbackToVersion("1.0.3");

    const { url, init } = lastCall();
    expect(url).toBe("/api/stocvest/admin/parameters/rollback");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(init?.cache).toBe("no-store");
    const body = JSON.parse(String(init?.body || "{}"));
    expect(body).toEqual({ target_version: "1.0.3" });
  });

  test("trims whitespace from target_version client-side", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: true,
        target_version: "1.0.3",
        rolled_back_from: "1.0.5",
        new_parameter_version: "1.0.6",
        error: null,
        extras: {}
      })
    );

    await rollbackToVersion("   1.0.3  ");

    const { init } = lastCall();
    const body = JSON.parse(String(init?.body || "{}"));
    expect(body).toEqual({ target_version: "1.0.3" });
  });

  test("returns bad_request when target_version is empty or whitespace", async () => {
    const outcome1 = await rollbackToVersion("");
    expect(outcome1.kind).toBe("error");
    if (outcome1.kind === "error") {
      expect(outcome1.code).toBe("bad_request");
      expect(outcome1.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();

    const outcome2 = await rollbackToVersion("   ");
    expect(outcome2.kind).toBe("error");
    if (outcome2.kind === "error") {
      expect(outcome2.code).toBe("bad_request");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("returns error outcome with backend envelope on 404", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: "not_found", message: "Parameter version '1.0.99' not found in history." },
        { status: 404 }
      )
    );

    const outcome = await rollbackToVersion("1.0.99");

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(404);
      expect(outcome.code).toBe("not_found");
      expect(outcome.message).toContain("1.0.99");
    }
  });

  test("returns error outcome with conflict envelope on 409", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: "conflict",
          message: "Target version is already live.",
          result: {
            success: false,
            target_version: "1.0.5",
            rolled_back_from: "1.0.5",
            new_parameter_version: null,
            error: "already on target version",
            extras: {}
          }
        },
        { status: 409 }
      )
    );

    const outcome = await rollbackToVersion("1.0.5");

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(409);
      expect(outcome.code).toBe("conflict");
      expect(outcome.message).toContain("already live");
    }
  });

  test("returns error outcome with internal_error on 500", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: "internal_error", message: "Rollback failed." },
        { status: 500 }
      )
    );

    const outcome = await rollbackToVersion("1.0.3");

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(500);
      expect(outcome.code).toBe("internal_error");
    }
  });

  test("surfaces auth error on 401 but still returns error outcome", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: "unauthorized", message: "expired" },
        { status: 401 }
      )
    );

    const outcome = await rollbackToVersion("1.0.3");

    expect(mocks.surfaceAuthErrorIfAny).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(401);
    }
  });

  test("returns malformed_response when 200 body is missing target_version", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true })
    );

    const outcome = await rollbackToVersion("1.0.3");

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("malformed_response");
      expect(outcome.status).toBe(200);
    }
  });

  test("returns network_error when fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const outcome = await rollbackToVersion("1.0.3");

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("network_error");
      expect(outcome.message).toBe("connection refused");
    }
  });

  test("gracefully handles unparseable error body", async () => {
    fetchMock.mockResolvedValue(
      new Response("not json", { status: 500, statusText: "Server Error" })
    );

    const outcome = await rollbackToVersion("1.0.3");

    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(500);
      expect(outcome.code).toBe("unknown");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Display helpers
// ───────────────────────────────────────────────────────────────────────────

describe("rollbackErrorLabel", () => {
  test("maps known codes to human messages", () => {
    expect(rollbackErrorLabel("conflict")).toContain("already live");
    expect(rollbackErrorLabel("not_found")).toContain("not in history");
    expect(rollbackErrorLabel("internal_error")).toContain("retry");
    expect(rollbackErrorLabel("bad_request")).toContain("target version");
    expect(rollbackErrorLabel("network_error")).toContain("Network");
    expect(rollbackErrorLabel("malformed_response")).toContain("unexpected");
  });

  test("falls back to generic label for unknown codes", () => {
    expect(rollbackErrorLabel("something_unexpected")).toBe("Rollback failed.");
  });
});

describe("formatAccuracyBeforeChange", () => {
  test("renders a percentage with one decimal", () => {
    expect(formatAccuracyBeforeChange(0.625)).toBe("62.5%");
    expect(formatAccuracyBeforeChange(0.6)).toBe("60.0%");
    expect(formatAccuracyBeforeChange(1.0)).toBe("100.0%");
  });

  test("renders em-dash for zero (writer's not-populated sentinel)", () => {
    expect(formatAccuracyBeforeChange(0)).toBe("—");
  });

  test("renders em-dash for negative or non-finite values", () => {
    expect(formatAccuracyBeforeChange(-0.5)).toBe("—");
    expect(formatAccuracyBeforeChange(NaN)).toBe("—");
    expect(formatAccuracyBeforeChange(Infinity)).toBe("—");
  });
});
