/**
 * Tests for `frontend/lib/api/admin-audit.ts` — the typed client for
 * the admin audit-log surface (recent feed + per-user feed).
 *
 * Pins:
 *
 * - `fetchRecentAuditEvents` forwards optional `module` / `routePrefix`
 *   filters as query params and skips empties.
 * - Both reads collapse to `null` on auth/non-2xx without throwing.
 * - Malformed event rows are filtered out (no `event_id` → dropped).
 * - `statusCodeTone` maps HTTP statuses to the four colour tones the UI
 *   uses without surprises at the boundaries.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surfaceAuthErrorIfAny: vi.fn().mockResolvedValue(false)
}));

vi.mock("@/lib/auth/surface-auth-error", () => ({
  surfaceAuthErrorIfAny: mocks.surfaceAuthErrorIfAny
}));

import {
  fetchRecentAuditEvents,
  fetchUserAuditEvents,
  statusCodeTone
} from "@/lib/api/admin-audit";

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

const SAMPLE_EVENT = {
  event_id: "evt-1",
  occurred_at: "2026-05-10T00:00:00Z",
  module: "signals",
  route: "GET /v1/admin/parameters/history",
  method: "GET",
  path: "/v1/admin/parameters/history",
  request_id: "req-1",
  session_id: "sess-1",
  user_id: "user-1",
  status_code: 200,
  outcome: "success",
  entitlement_snapshot: {},
  pricing_snapshot: {},
  request_summary: {},
  response_summary: {},
  market_snapshot: {}
};

// ── fetchRecentAuditEvents ───────────────────────────────────────────────

describe("fetchRecentAuditEvents", () => {
  test("happy path with no filters hits the base URL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ limit: 100, module: null, route_prefix: null, items: [SAMPLE_EVENT] })
    );
    const result = await fetchRecentAuditEvents();
    expect(result?.items).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/stocvest/admin/audit/recent");
  });

  test("forwards limit/module/route_prefix as query params", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ limit: 25, module: "signals", route_prefix: "GET /v1/admin", items: [] })
    );
    await fetchRecentAuditEvents({
      limit: 25,
      module: "signals",
      routePrefix: "GET /v1/admin"
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("limit=25");
    expect(url).toContain("module=signals");
    expect(url).toContain("route_prefix=GET+%2Fv1%2Fadmin");
  });

  test("skips empty filter values", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [] }));
    await fetchRecentAuditEvents({ module: "   ", routePrefix: "" });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/stocvest/admin/audit/recent"
    );
  });

  test("401 surfaces auth error and returns null", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    expect(await fetchRecentAuditEvents()).toBeNull();
    expect(mocks.surfaceAuthErrorIfAny).toHaveBeenCalled();
  });

  test("non-2xx returns null", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect(await fetchRecentAuditEvents()).toBeNull();
  });

  test("drops malformed event rows (missing event_id)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ items: [SAMPLE_EVENT, { occurred_at: "x" }, null] })
    );
    const result = await fetchRecentAuditEvents();
    expect(result?.items).toHaveLength(1);
  });
});

// ── fetchUserAuditEvents ─────────────────────────────────────────────────

describe("fetchUserAuditEvents", () => {
  test("empty user_id returns null without firing fetch", async () => {
    expect(await fetchUserAuditEvents("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("happy path returns parsed array", async () => {
    fetchMock.mockResolvedValue(jsonResponse([SAMPLE_EVENT]));
    const events = await fetchUserAuditEvents("user-1", { limit: 5 });
    expect(events).toHaveLength(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe("/api/stocvest/admin/audit/users/user-1?limit=5");
  });

  test("upstream non-array body returns null", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [SAMPLE_EVENT] }));
    expect(await fetchUserAuditEvents("user-1")).toBeNull();
  });
});

// ── statusCodeTone ───────────────────────────────────────────────────────

describe("statusCodeTone", () => {
  test.each([
    [0, "neutral"],
    [200, "success"],
    [299, "success"],
    [400, "warning"],
    [403, "warning"],
    [499, "warning"],
    [500, "error"],
    [503, "error"],
    [100, "neutral"]
  ])("status %i → %s", (code, expected) => {
    expect(statusCodeTone(code)).toBe(expected);
  });
});
