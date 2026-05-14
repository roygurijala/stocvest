/**
 * Tests for the D10 Phase 5 BFF routes under
 * `frontend/app/api/stocvest/admin/users/*` and `/audit/*`,
 * `/parameters/current`, `/system-status`.
 *
 * Each route is a thin status-and-body passthrough on top of
 * `stocvestAuthedFetch`. These tests pin:
 *
 * - Correct upstream paths are hit, including verbatim query-string
 *   forwarding on `users/search` and `audit/recent`.
 * - Status codes (200/400/403/404/500) pass through unchanged.
 * - The content-type header survives the proxy.
 * - URL-encoded user_ids round-trip safely (so emails with `+` and
 *   subs with `:` reach Cognito intact).
 * - The beta-access PATCH route preserves the request body verbatim
 *   so the upstream handler validates it.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stocvestAuthedFetch: vi.fn()
}));

vi.mock("@/lib/bff/stocvest-authed", () => ({
  stocvestAuthedFetch: mocks.stocvestAuthedFetch
}));

beforeEach(() => {
  mocks.stocvestAuthedFetch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

function jsonUpstreamResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) }
  });
}

function lastUpstreamCall(): { path: string; init?: RequestInit } {
  const call = mocks.stocvestAuthedFetch.mock.calls.at(-1);
  if (!call) throw new Error("stocvestAuthedFetch was not called");
  return { path: String(call[0]), init: call[1] as RequestInit | undefined };
}

// ── GET /api/stocvest/admin/users/search ─────────────────────────────────

describe("BFF: GET /api/stocvest/admin/users/search", () => {
  test("forwards q + limit query string", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ query: "ali", limit: 25, items: [] })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/users/search/route"
    );
    const res = await GET(
      new Request(
        "http://test.local/api/stocvest/admin/users/search?q=ali&limit=10"
      )
    );
    expect(res.status).toBe(200);
    expect(lastUpstreamCall().path).toBe(
      "/v1/admin/users/search?q=ali&limit=10"
    );
  });

  test("missing query string forwards bare path", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ items: [] })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/users/search/route"
    );
    await GET(new Request("http://test.local/api/stocvest/admin/users/search"));
    expect(lastUpstreamCall().path).toBe("/v1/admin/users/search");
  });

  test("403 passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ error: "forbidden" }, { status: 403 })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/users/search/route"
    );
    const res = await GET(
      new Request("http://test.local/api/stocvest/admin/users/search")
    );
    expect(res.status).toBe(403);
  });
});

// ── GET /api/stocvest/admin/users/[user_id] ──────────────────────────────

describe("BFF: GET /api/stocvest/admin/users/[user_id]", () => {
  test("encodes user_id with special chars", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ user_id: "x" })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/route"
    );
    await GET(
      new Request(
        "http://test.local/api/stocvest/admin/users/aws%3Acognito%2Bspecial"
      ),
      { params: { user_id: "aws:cognito+special" } }
    );
    expect(lastUpstreamCall().path).toBe(
      "/v1/admin/users/aws%3Acognito%2Bspecial"
    );
  });

  test("404 passes through", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ error: "not_found" }, { status: 404 })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/route"
    );
    const res = await GET(
      new Request("http://test.local/api/stocvest/admin/users/missing"),
      { params: { user_id: "missing" } }
    );
    expect(res.status).toBe(404);
  });
});

// ── POST /api/stocvest/admin/users/[user_id]/reset-password ──────────────

describe("BFF: POST /api/stocvest/admin/users/[user_id]/reset-password", () => {
  test("hits the upstream reset-password route", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ user_id: "user-1", username: "u", message: "ok" })
    );
    const { POST } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/reset-password/route"
    );
    const res = await POST(
      new Request(
        "http://test.local/api/stocvest/admin/users/user-1/reset-password",
        { method: "POST" }
      ),
      { params: { user_id: "user-1" } }
    );
    expect(res.status).toBe(200);
    const { path, init } = lastUpstreamCall();
    expect(path).toBe("/v1/admin/users/user-1/reset-password");
    expect(init?.method).toBe("POST");
  });

  test("forbidden upstream passes through", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ error: "forbidden" }, { status: 403 })
    );
    const { POST } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/reset-password/route"
    );
    const res = await POST(
      new Request(
        "http://test.local/api/stocvest/admin/users/user-1/reset-password",
        { method: "POST" }
      ),
      { params: { user_id: "user-1" } }
    );
    expect(res.status).toBe(403);
  });
});

// ── POST/DELETE /api/stocvest/admin/users/[user_id]/groups/[group] ───────

describe("BFF: groups mutations", () => {
  test("POST forwards to /groups/{group}", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({
        user_id: "user-1",
        group: "signal-analytics-admin",
        action: "add"
      })
    );
    const { POST } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/groups/[group]/route"
    );
    const res = await POST(
      new Request(
        "http://test.local/api/stocvest/admin/users/user-1/groups/signal-analytics-admin",
        { method: "POST" }
      ),
      { params: { user_id: "user-1", group: "signal-analytics-admin" } }
    );
    expect(res.status).toBe(200);
    const { path, init } = lastUpstreamCall();
    expect(path).toBe(
      "/v1/admin/users/user-1/groups/signal-analytics-admin"
    );
    expect(init?.method).toBe("POST");
  });

  test("DELETE forwards to /groups/{group}", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({
        user_id: "user-1",
        group: "signal-analytics-admin",
        action: "remove"
      })
    );
    const { DELETE } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/groups/[group]/route"
    );
    const res = await DELETE(
      new Request(
        "http://test.local/api/stocvest/admin/users/user-1/groups/signal-analytics-admin",
        { method: "DELETE" }
      ),
      { params: { user_id: "user-1", group: "signal-analytics-admin" } }
    );
    expect(res.status).toBe(200);
    expect(lastUpstreamCall().init?.method).toBe("DELETE");
  });

  test("400 on bad group passes through", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse(
        { error: "bad_request", message: "Group not assignable" },
        { status: 400 }
      )
    );
    const { POST } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/groups/[group]/route"
    );
    const res = await POST(
      new Request("http://test.local/api/stocvest/admin/users/u/groups/bad", {
        method: "POST"
      }),
      { params: { user_id: "u", group: "bad" } }
    );
    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/stocvest/admin/users/[user_id]/beta-access ────────────────

describe("BFF: PATCH beta-access", () => {
  test("forwards body verbatim", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ ok: true })
    );
    const { PATCH } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/beta-access/route"
    );
    const body = JSON.stringify({ enabled: true, indefinite: true });
    const res = await PATCH(
      new Request(
        "http://test.local/api/stocvest/admin/users/user-1/beta-access",
        {
          method: "PATCH",
          body,
          headers: { "content-type": "application/json" }
        }
      ),
      { params: { user_id: "user-1" } }
    );
    expect(res.status).toBe(200);
    const { path, init } = lastUpstreamCall();
    expect(path).toBe("/v1/admin/users/user-1/beta-access");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(body);
  });

  test("empty body becomes '{}'", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ error: "bad_request" }, { status: 400 })
    );
    const { PATCH } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/beta-access/route"
    );
    await PATCH(
      new Request(
        "http://test.local/api/stocvest/admin/users/user-1/beta-access",
        { method: "PATCH" }
      ),
      { params: { user_id: "user-1" } }
    );
    expect(lastUpstreamCall().init?.body).toBe("{}");
  });
});

// ── GET /api/stocvest/admin/users/[user_id]/activity-errors ─────────────

describe("BFF: GET /api/stocvest/admin/users/[user_id]/activity-errors", () => {
  test("forwards encoded user_id and days query", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ user_id: "u1", days: 7, cutoff_utc: "", items: [] })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/activity-errors/route"
    );
    await GET(
      new Request(
        "http://test.local/api/stocvest/admin/users/user-1/activity-errors?days=14"
      ),
      { params: { user_id: "user-1" } }
    );
    expect(lastUpstreamCall().path).toBe(
      "/v1/admin/users/user-1/activity-errors?days=14"
    );
  });

  test("no query forwards bare activity-errors path", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ user_id: "u1", days: 7, cutoff_utc: "", items: [] })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/users/[user_id]/activity-errors/route"
    );
    await GET(
      new Request("http://test.local/api/stocvest/admin/users/aws%3Acognito/activity-errors"),
      { params: { user_id: "aws:cognito" } }
    );
    expect(lastUpstreamCall().path).toBe(
      "/v1/admin/users/aws%3Acognito/activity-errors"
    );
  });
});

describe("BFF: GET /audit/recent", () => {
  test("forwards query verbatim", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ items: [] })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/audit/recent/route"
    );
    await GET(
      new Request(
        "http://test.local/api/stocvest/admin/audit/recent?limit=50&module=signals"
      )
    );
    expect(lastUpstreamCall().path).toBe(
      "/v1/admin/audit/recent?limit=50&module=signals"
    );
  });

  test("no query forwards bare path", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ items: [] })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/audit/recent/route"
    );
    await GET(new Request("http://test.local/api/stocvest/admin/audit/recent"));
    expect(lastUpstreamCall().path).toBe("/v1/admin/audit/recent");
  });
});

// ── GET /api/stocvest/admin/audit/users/[user_id] ────────────────────────

describe("BFF: GET /audit/users/[user_id]", () => {
  test("forwards encoded user_id + limit", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(jsonUpstreamResponse([]));
    const { GET } = await import(
      "@/app/api/stocvest/admin/audit/users/[user_id]/route"
    );
    await GET(
      new Request(
        "http://test.local/api/stocvest/admin/audit/users/user-1?limit=20"
      ),
      { params: { user_id: "user-1" } }
    );
    expect(lastUpstreamCall().path).toBe(
      "/v1/admin/audit/users/user-1?limit=20"
    );
  });
});

// ── GET /api/stocvest/admin/parameters/current ───────────────────────────

describe("BFF: GET /parameters/current", () => {
  test("hits upstream and preserves content-type", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ version: "1.0", created_at: "", notes: "", parameters: {} })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/parameters/current/route"
    );
    const res = await GET(
      new Request("http://test.local/api/stocvest/admin/parameters/current")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(lastUpstreamCall().path).toBe("/v1/admin/parameters/current");
  });

  test("403 passes through", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ error: "forbidden" }, { status: 403 })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/parameters/current/route"
    );
    const res = await GET(
      new Request("http://test.local/api/stocvest/admin/parameters/current")
    );
    expect(res.status).toBe(403);
  });
});

// ── GET /api/stocvest/admin/system-status ────────────────────────────────

describe("BFF: GET /system-status", () => {
  test("hits upstream and passes 200 through", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({
        current_parameter: { version: "1.0", created_at: "", notes: "" },
        latest_history: null,
        pending_proposal_count: 0,
        admin_user_count: 0,
        founding_member_count: 0,
        recent_audit_events: []
      })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/system-status/route"
    );
    const res = await GET(
      new Request("http://test.local/api/stocvest/admin/system-status")
    );
    expect(res.status).toBe(200);
    expect(lastUpstreamCall().path).toBe("/v1/admin/system-status");
  });

  test("500 passes through", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ error: "internal_error" }, { status: 500 })
    );
    const { GET } = await import(
      "@/app/api/stocvest/admin/system-status/route"
    );
    const res = await GET(
      new Request("http://test.local/api/stocvest/admin/system-status")
    );
    expect(res.status).toBe(500);
  });
});
