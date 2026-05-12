/**
 * Tests for the D10 Phase 4 BFF routes under
 * `frontend/app/api/stocvest/admin/parameters/*`.
 *
 * Each route is a thin status-and-body passthrough on top of
 * `stocvestAuthedFetch`. The BFFs do no request shaping or response
 * parsing — that lives in the upstream backend handlers + the typed
 * client at `lib/api/admin-parameters.ts`.
 *
 * These tests pin:
 *
 * - Correct upstream paths are hit for each route, including verbatim
 *   query-string forwarding for the history route.
 * - Status codes (200 / 400 / 403 / 404 / 409 / 500) pass through unchanged.
 * - The content-type header is preserved.
 * - The rollback route forwards the request body verbatim so the upstream
 *   handler can validate `target_version` consistently.
 * - An empty rollback body is replaced with `{}` so the backend's JSON
 *   parser produces a clean 400 ("target_version is required") instead
 *   of a parse error.
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

// ── GET /api/stocvest/admin/parameters/history ──────────────────────────────

describe("BFF: GET /api/stocvest/admin/parameters/history", () => {
  test("forwards verbatim query string to /v1/admin/parameters/history", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ limit: 50, items: [] })
    );
    const { GET } = await import("@/app/api/stocvest/admin/parameters/history/route");
    const res = await GET(
      new Request("http://test.local/api/stocvest/admin/parameters/history?limit=10")
    );
    expect(res.status).toBe(200);
    const { path, init } = lastUpstreamCall();
    expect(path).toBe("/v1/admin/parameters/history?limit=10");
    expect(init?.method).toBe("GET");
  });

  test("forwards a missing query string without trailing '?'", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ limit: 50, items: [] })
    );
    const { GET } = await import("@/app/api/stocvest/admin/parameters/history/route");
    await GET(new Request("http://test.local/api/stocvest/admin/parameters/history"));
    expect(lastUpstreamCall().path).toBe("/v1/admin/parameters/history");
  });

  test("upstream 403 (non-admin) passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );
    const { GET } = await import("@/app/api/stocvest/admin/parameters/history/route");
    const res = await GET(
      new Request("http://test.local/api/stocvest/admin/parameters/history")
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });

  test("upstream 500 passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      new Response("boom", { status: 500, headers: { "content-type": "text/plain" } })
    );
    const { GET } = await import("@/app/api/stocvest/admin/parameters/history/route");
    const res = await GET(
      new Request("http://test.local/api/stocvest/admin/parameters/history")
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  test("preserves content-type when upstream returns JSON", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ limit: 50, items: [] })
    );
    const { GET } = await import("@/app/api/stocvest/admin/parameters/history/route");
    const res = await GET(
      new Request("http://test.local/api/stocvest/admin/parameters/history")
    );
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

// ── POST /api/stocvest/admin/parameters/rollback ────────────────────────────

describe("BFF: POST /api/stocvest/admin/parameters/rollback", () => {
  test("forwards the request body verbatim to /v1/admin/parameters/rollback", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({
        success: true,
        target_version: "1.0.3",
        rolled_back_from: "1.0.5",
        new_parameter_version: "1.0.6",
        error: null,
        extras: {}
      })
    );
    const { POST } = await import("@/app/api/stocvest/admin/parameters/rollback/route");
    const body = JSON.stringify({ target_version: "1.0.3" });
    const res = await POST(
      new Request("http://test.local/api/stocvest/admin/parameters/rollback", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" }
      })
    );
    expect(res.status).toBe(200);
    const { path, init } = lastUpstreamCall();
    expect(path).toBe("/v1/admin/parameters/rollback");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(body);
  });

  test("replaces an empty incoming body with '{}'", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ error: "bad_request", message: "target_version is required" }, { status: 400 })
    );
    const { POST } = await import("@/app/api/stocvest/admin/parameters/rollback/route");
    const res = await POST(
      new Request("http://test.local/api/stocvest/admin/parameters/rollback", {
        method: "POST"
      })
    );
    expect(res.status).toBe(400);
    const { init } = lastUpstreamCall();
    expect(init?.body).toBe("{}");
  });

  test("upstream 404 (target not in history) passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse(
        { error: "not_found", message: "Parameter version '1.0.99' not found in history." },
        { status: 404 }
      )
    );
    const { POST } = await import("@/app/api/stocvest/admin/parameters/rollback/route");
    const res = await POST(
      new Request("http://test.local/api/stocvest/admin/parameters/rollback", {
        method: "POST",
        body: JSON.stringify({ target_version: "1.0.99" })
      })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  test("upstream 409 (already on target version) passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse(
        {
          error: "conflict",
          message: "Target version is already live.",
          result: { success: false, target_version: "1.0.5" }
        },
        { status: 409 }
      )
    );
    const { POST } = await import("@/app/api/stocvest/admin/parameters/rollback/route");
    const res = await POST(
      new Request("http://test.local/api/stocvest/admin/parameters/rollback", {
        method: "POST",
        body: JSON.stringify({ target_version: "1.0.5" })
      })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("conflict");
  });

  test("upstream 403 (non-admin) passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({ error: "forbidden" }, { status: 403 })
    );
    const { POST } = await import("@/app/api/stocvest/admin/parameters/rollback/route");
    const res = await POST(
      new Request("http://test.local/api/stocvest/admin/parameters/rollback", {
        method: "POST",
        body: JSON.stringify({ target_version: "1.0.3" })
      })
    );
    expect(res.status).toBe(403);
  });

  test("upstream 500 (parameter save failed) passes through unchanged", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse(
        { error: "internal_error", message: "Rollback failed." },
        { status: 500 }
      )
    );
    const { POST } = await import("@/app/api/stocvest/admin/parameters/rollback/route");
    const res = await POST(
      new Request("http://test.local/api/stocvest/admin/parameters/rollback", {
        method: "POST",
        body: JSON.stringify({ target_version: "1.0.3" })
      })
    );
    expect(res.status).toBe(500);
  });

  test("preserves content-type when upstream returns JSON", async () => {
    mocks.stocvestAuthedFetch.mockResolvedValueOnce(
      jsonUpstreamResponse({
        success: true,
        target_version: "1.0.3",
        rolled_back_from: "1.0.5",
        new_parameter_version: "1.0.6",
        error: null,
        extras: {}
      })
    );
    const { POST } = await import("@/app/api/stocvest/admin/parameters/rollback/route");
    const res = await POST(
      new Request("http://test.local/api/stocvest/admin/parameters/rollback", {
        method: "POST",
        body: JSON.stringify({ target_version: "1.0.3" })
      })
    );
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
