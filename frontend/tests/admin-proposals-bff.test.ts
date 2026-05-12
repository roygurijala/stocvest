/**
 * Tests for the D10 Phase 3b BFF routes under
 * `frontend/app/api/stocvest/admin/proposals/*`.
 *
 * Each route is a thin status-and-body passthrough on top of
 * `stocvestAuthedFetch` (which attaches the user's Cognito JWT from the
 * httpOnly cookie to the upstream call). The BFFs deliberately do **no**
 * request shaping or response parsing — that responsibility lives in the
 * upstream backend handlers + the dashboard's typed client.
 *
 * These tests pin:
 *
 * - The correct upstream path is hit for each route, including URL-encoded
 *   proposal IDs and verbatim query-string forwarding for the list route.
 * - Status codes (200 / 400 / 403 / 404 / 409 / 500) pass through unchanged.
 * - The content-type header is preserved (the typed client relies on JSON
 *   parsing).
 * - The reject route forwards the request body verbatim so the upstream
 *   handler can validate the `review_note` field consistently.
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

// Each describe block dynamic-imports the route module so the `vi.mock` for
// `stocvestAuthedFetch` is applied before the route's import is resolved.
// (vi.mock is hoisted above the dynamic-import boundary; importing eagerly
// at file top would race with the mock setup in some Vitest configs.)

// ── GET /api/stocvest/admin/proposals (list) ────────────────────────────────

describe("BFF: GET /api/stocvest/admin/proposals", () => {
  test("forwards verbatim query string to /v1/admin/proposals", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ status: "pending", limit: 50, items: [] })
    );
    const { GET } = await import("@/app/api/stocvest/admin/proposals/route");
    const res = await GET(new Request("http://test.local/api/stocvest/admin/proposals?status=pending&limit=50"));
    expect(res.status).toBe(200);
    const { path, init } = lastUpstreamCall();
    expect(path).toBe("/v1/admin/proposals?status=pending&limit=50");
    expect(init?.method).toBe("GET");
  });

  test("forwards a missing query string without a trailing '?'", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ status: "pending", limit: 20, items: [] })
    );
    const { GET } = await import("@/app/api/stocvest/admin/proposals/route");
    await GET(new Request("http://test.local/api/stocvest/admin/proposals"));
    expect(lastUpstreamCall().path).toBe("/v1/admin/proposals");
  });

  test("upstream 403 (non-admin) passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );
    const { GET } = await import("@/app/api/stocvest/admin/proposals/route");
    const res = await GET(new Request("http://test.local/api/stocvest/admin/proposals"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  test("upstream 500 passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      new Response("boom", { status: 500, headers: { "content-type": "text/plain" } })
    );
    const { GET } = await import("@/app/api/stocvest/admin/proposals/route");
    const res = await GET(new Request("http://test.local/api/stocvest/admin/proposals"));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("boom");
  });

  test("preserves the upstream content-type header", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      new Response("{}", { status: 200, headers: { "content-type": "application/json; charset=utf-8" } })
    );
    const { GET } = await import("@/app/api/stocvest/admin/proposals/route");
    const res = await GET(new Request("http://test.local/api/stocvest/admin/proposals"));
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

// ── GET /api/stocvest/admin/proposals/[proposal_id] (detail) ────────────────

describe("BFF: GET /api/stocvest/admin/proposals/[proposal_id]", () => {
  test("URL-encodes the proposal_id path segment", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(jsonUpstreamResponse({ proposal_id: "prop/1" }));
    const { GET } = await import("@/app/api/stocvest/admin/proposals/[proposal_id]/route");
    await GET(new Request("http://test.local/x"), { params: { proposal_id: "prop/1" } });
    expect(lastUpstreamCall().path).toBe("/v1/admin/proposals/prop%2F1");
  });

  test("upstream 404 passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "proposal_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      })
    );
    const { GET } = await import("@/app/api/stocvest/admin/proposals/[proposal_id]/route");
    const res = await GET(new Request("http://test.local/x"), { params: { proposal_id: "missing" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "proposal_not_found" });
  });

  test("happy path forwards 200 + JSON body verbatim", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ proposal_id: "prop-1", status: "pending" })
    );
    const { GET } = await import("@/app/api/stocvest/admin/proposals/[proposal_id]/route");
    const res = await GET(new Request("http://test.local/x"), { params: { proposal_id: "prop-1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ proposal_id: "prop-1" });
  });
});

// ── POST /api/stocvest/admin/proposals/[proposal_id]/promote ────────────────

describe("BFF: POST /api/stocvest/admin/proposals/[proposal_id]/promote", () => {
  test("forwards POST to the encoded promote path with an empty JSON body", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({
        success: true,
        proposal_id: "prop-1",
        new_parameter_version: "4",
        superseded_pending_ids: [],
        error: null
      })
    );
    const { POST } = await import("@/app/api/stocvest/admin/proposals/[proposal_id]/promote/route");
    const res = await POST(new Request("http://test.local/x", { method: "POST" }), {
      params: { proposal_id: "prop-1" }
    });
    expect(res.status).toBe(200);
    const { path, init } = lastUpstreamCall();
    expect(path).toBe("/v1/admin/proposals/prop-1/promote");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({}));
  });

  test("upstream 409 (proposal not pending) passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "proposal_not_pending" }), {
        status: 409,
        headers: { "content-type": "application/json" }
      })
    );
    const { POST } = await import("@/app/api/stocvest/admin/proposals/[proposal_id]/promote/route");
    const res = await POST(new Request("http://test.local/x", { method: "POST" }), {
      params: { proposal_id: "prop-1" }
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "proposal_not_pending" });
  });

  test("upstream 500 (secret save failed) passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "secret_save_failed" }), {
        status: 500,
        headers: { "content-type": "application/json" }
      })
    );
    const { POST } = await import("@/app/api/stocvest/admin/proposals/[proposal_id]/promote/route");
    const res = await POST(new Request("http://test.local/x", { method: "POST" }), {
      params: { proposal_id: "prop-1" }
    });
    expect(res.status).toBe(500);
  });
});

// ── POST /api/stocvest/admin/proposals/[proposal_id]/reject ─────────────────

describe("BFF: POST /api/stocvest/admin/proposals/[proposal_id]/reject", () => {
  test("forwards the request body verbatim when a review_note is provided", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ proposal_id: "prop-1", status: "rejected", review_note: "stale" })
    );
    const { POST } = await import("@/app/api/stocvest/admin/proposals/[proposal_id]/reject/route");
    const body = JSON.stringify({ review_note: "stale" });
    await POST(
      new Request("http://test.local/x", { method: "POST", body }),
      { params: { proposal_id: "prop-1" } }
    );
    const { path, init } = lastUpstreamCall();
    expect(path).toBe("/v1/admin/proposals/prop-1/reject");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(body);
  });

  test("substitutes an empty JSON body when the incoming body is empty", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ proposal_id: "prop-1", status: "rejected" })
    );
    const { POST } = await import("@/app/api/stocvest/admin/proposals/[proposal_id]/reject/route");
    await POST(new Request("http://test.local/x", { method: "POST" }), {
      params: { proposal_id: "prop-1" }
    });
    expect(lastUpstreamCall().init?.body).toBe(JSON.stringify({}));
  });

  test("upstream 400 (bad review_note) passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad_review_note" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );
    const { POST } = await import("@/app/api/stocvest/admin/proposals/[proposal_id]/reject/route");
    const res = await POST(
      new Request("http://test.local/x", {
        method: "POST",
        body: JSON.stringify({ review_note: 42 })
      }),
      { params: { proposal_id: "prop-1" } }
    );
    expect(res.status).toBe(400);
  });

  test("URL-encodes the proposal_id path segment", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ proposal_id: "weird/id", status: "rejected" })
    );
    const { POST } = await import("@/app/api/stocvest/admin/proposals/[proposal_id]/reject/route");
    await POST(new Request("http://test.local/x", { method: "POST" }), {
      params: { proposal_id: "weird/id" }
    });
    expect(lastUpstreamCall().path).toBe("/v1/admin/proposals/weird%2Fid/reject");
  });
});
