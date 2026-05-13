/**
 * Lock-in: ``searchUsersDiagnostic`` surfaces the backend's
 * ``{ error, code, message, hint }`` envelope for non-2xx responses
 * — in particular the 503 ``config_error`` body that the API Lambda
 * returns when ``COGNITO_USER_POOL_ID`` is unset (see
 * ``stocvest/api/handlers/admin_users.py::_require_cognito_pool``).
 *
 * Before this wiring, the admin Users page rendered the generic
 * "No users found in the pool yet." copy when the pool id was
 * missing, because the backend silently returned an empty page and
 * the frontend had no way to distinguish that from a real empty
 * pool. The 503 envelope + ``readAdminErrorEnvelope`` together make
 * the failure mode visible in ``AdminApiErrorCard``.
 *
 * These tests pin the contract end-to-end at the typed-client layer
 * so a future refactor that drops the body read on non-2xx (or that
 * collapses 503 / 400 back to ``classifyAdminReadStatus`` only)
 * fails loud.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surfaceAuthErrorIfAny: vi.fn().mockResolvedValue(false)
}));

vi.mock("@/lib/auth/surface-auth-error", () => ({
  surfaceAuthErrorIfAny: mocks.surfaceAuthErrorIfAny
}));

import {
  readAdminErrorEnvelope,
  searchUsersDiagnostic
} from "@/lib/api/admin-users";

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

describe("readAdminErrorEnvelope (direct)", () => {
  test("503 + cognito_pool_unset maps to not_deployed with backend message + hint", async () => {
    const response = jsonResponse(
      {
        error: "config_error",
        code: "cognito_pool_unset",
        message: "The backend cannot reach Cognito — COGNITO_USER_POOL_ID is not set on the API Lambda environment.",
        hint: "Run `terraform apply` from /infra; the env var is wired in lambda_6e.tf under `lambda_common_env`."
      },
      { status: 503 }
    );
    const err = await readAdminErrorEnvelope(response);
    expect(err.code).toBe("not_deployed");
    expect(err.status).toBe(503);
    expect(err.message).toContain("COGNITO_USER_POOL_ID");
    expect(err.hint).toContain("terraform apply");
  });

  test("backend-provided message/hint override the generic copy for other 5xx", async () => {
    const response = jsonResponse(
      {
        error: "upstream_error",
        message: "Specific upstream failure copy.",
        hint: "Specific actionable hint."
      },
      { status: 502 }
    );
    const err = await readAdminErrorEnvelope(response);
    expect(err.code).toBe("upstream_error");
    expect(err.status).toBe(502);
    expect(err.message).toBe("Specific upstream failure copy.");
    expect(err.hint).toBe("Specific actionable hint.");
  });

  test("body without message/hint falls back to classifyAdminReadStatus copy", async () => {
    const response = jsonResponse({ error: "upstream_error" }, { status: 500 });
    const err = await readAdminErrorEnvelope(response);
    expect(err.status).toBe(500);
    expect(err.message).not.toBe("");
    expect(err.hint).not.toBe("");
  });

  test("non-JSON body falls back gracefully without throwing", async () => {
    const response = new Response("not json", {
      status: 500,
      headers: { "content-type": "text/plain" }
    });
    const err = await readAdminErrorEnvelope(response);
    expect(err.status).toBe(500);
    expect(err.code).toBe("upstream_error");
  });

  test("404 with backend hint still maps to not_deployed (route missing)", async () => {
    const response = jsonResponse(
      { error: "not_found", message: "Route not deployed.", hint: "Run terraform apply." },
      { status: 404 }
    );
    const err = await readAdminErrorEnvelope(response);
    expect(err.code).toBe("not_deployed");
    expect(err.message).toBe("Route not deployed.");
    expect(err.hint).toBe("Run terraform apply.");
  });
});

describe("searchUsersDiagnostic (end-to-end)", () => {
  test("503 config_error body flows into the AdminApiReadError envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: "config_error",
          code: "cognito_pool_unset",
          message: "Cognito pool id missing.",
          hint: "Run terraform apply."
        },
        { status: 503 }
      )
    );
    const outcome = await searchUsersDiagnostic("");
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") return;
    expect(outcome.error.code).toBe("not_deployed");
    expect(outcome.error.status).toBe(503);
    expect(outcome.error.message).toBe("Cognito pool id missing.");
    expect(outcome.error.hint).toBe("Run terraform apply.");
  });

  test("happy path still parses items + next_token correctly", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        query: "",
        limit: 25,
        items: [
          {
            user_id: "u-1",
            username: "a@example.com",
            email: "a@example.com",
            email_verified: true,
            status: "CONFIRMED",
            enabled: true,
            created_at: "2026-05-13T00:00:00Z",
            updated_at: "2026-05-13T00:00:00Z"
          }
        ],
        next_token: null
      })
    );
    const outcome = await searchUsersDiagnostic("");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.data.items).toHaveLength(1);
    expect(outcome.data.items[0].user_id).toBe("u-1");
  });
});
