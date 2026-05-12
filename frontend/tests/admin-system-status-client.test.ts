/**
 * Tests for `frontend/lib/api/admin-system-status.ts` — the typed
 * client behind the admin Hub Overview tile.
 *
 * Pins:
 *
 * - Happy path parses every nested field (current_parameter,
 *   latest_history, counts, recent_audit_events).
 * - Defensive defaults: a missing/null `latest_history` collapses to
 *   `null` rather than throwing; counts default to 0; malformed
 *   audit rows are dropped.
 * - Auth-401 calls `surfaceAuthErrorIfAny` and returns `null`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surfaceAuthErrorIfAny: vi.fn().mockResolvedValue(false)
}));

vi.mock("@/lib/auth/surface-auth-error", () => ({
  surfaceAuthErrorIfAny: mocks.surfaceAuthErrorIfAny
}));

import { fetchSystemStatus } from "@/lib/api/admin-system-status";

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

const SAMPLE_PAYLOAD = {
  current_parameter: {
    version: "1.0.5",
    created_at: "2026-05-10T00:00:00Z",
    notes: "promotion"
  },
  latest_history: {
    version: "1.0.5",
    created_at: "2026-05-10T00:00:00Z",
    reason: "promotion v1.0.5",
    changed_by: "d10-admin:alice",
    signal_count_on_change: 100,
    accuracy_before_change: 0.62,
    is_current_live_version: true
  },
  pending_proposal_count: 2,
  admin_user_count: 3,
  founding_member_count: 5,
  recent_audit_events: [
    {
      event_id: "evt-1",
      occurred_at: "2026-05-10T00:00:00Z",
      module: "signals",
      route: "GET /v1/admin/audit/recent",
      method: "GET",
      path: "/v1/admin/audit/recent",
      request_id: null,
      session_id: null,
      user_id: "user-1",
      status_code: 200,
      outcome: "success",
      entitlement_snapshot: {},
      pricing_snapshot: {},
      request_summary: {},
      response_summary: {},
      market_snapshot: {}
    }
  ]
};

describe("fetchSystemStatus", () => {
  test("happy path parses every field", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_PAYLOAD));
    const result = await fetchSystemStatus();
    expect(result?.current_parameter.version).toBe("1.0.5");
    expect(result?.latest_history?.version).toBe("1.0.5");
    expect(result?.pending_proposal_count).toBe(2);
    expect(result?.admin_user_count).toBe(3);
    expect(result?.founding_member_count).toBe(5);
    expect(result?.recent_audit_events).toHaveLength(1);
  });

  test("null latest_history collapses cleanly", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...SAMPLE_PAYLOAD, latest_history: null })
    );
    const result = await fetchSystemStatus();
    expect(result?.latest_history).toBeNull();
  });

  test("missing counts default to 0", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        current_parameter: { version: "1.0.0", created_at: "", notes: "" },
        latest_history: null,
        recent_audit_events: []
      })
    );
    const result = await fetchSystemStatus();
    expect(result?.pending_proposal_count).toBe(0);
    expect(result?.admin_user_count).toBe(0);
    expect(result?.founding_member_count).toBe(0);
  });

  test("malformed audit rows filtered out", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...SAMPLE_PAYLOAD,
        recent_audit_events: [
          SAMPLE_PAYLOAD.recent_audit_events[0],
          { occurred_at: "no-id" },
          null
        ]
      })
    );
    const result = await fetchSystemStatus();
    expect(result?.recent_audit_events).toHaveLength(1);
  });

  test("401 returns null and surfaces auth error", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    expect(await fetchSystemStatus()).toBeNull();
    expect(mocks.surfaceAuthErrorIfAny).toHaveBeenCalled();
  });

  test("non-2xx returns null", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect(await fetchSystemStatus()).toBeNull();
  });

  test("network error returns null", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await fetchSystemStatus()).toBeNull();
  });

  test("malformed top-level body returns null", async () => {
    fetchMock.mockResolvedValue(jsonResponse([1, 2, 3]));
    expect(await fetchSystemStatus()).toBeNull();
  });
});
