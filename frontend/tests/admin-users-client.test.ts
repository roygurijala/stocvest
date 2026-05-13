/**
 * Tests for `frontend/lib/api/admin-users.ts` — the D10 Phase 5 typed
 * client for the admin user-management surface.
 *
 * The client is a thin layer over five BFF routes under
 * `/api/stocvest/admin/users/*`. Each BFF proxies verbatim to the
 * upstream backend handler in `stocvest/api/handlers/admin_users.py`.
 *
 * What these tests pin:
 *
 * - `searchUsers` and `fetchUserDetail` collapse to `null` on auth
 *   failure, malformed payloads, or any non-2xx — never throw.
 * - `searchUsers` short-circuits on an empty query (no fetch fired) so
 *   typing-then-clearing the box doesn't slam Cognito.
 * - Mutations (`resetUserPassword`, `addUserToGroup`,
 *   `removeUserFromGroup`) return a discriminated outcome carrying
 *   the upstream status + error envelope (so the UI can map
 *   403 / 404 / 400 to friendly text without re-parsing).
 * - `userMutationErrorLabel` maps every known error code to a
 *   non-empty user-facing string.
 * - URLs are correctly path-encoded so user_ids with `+` / spaces /
 *   `:` survive the round-trip.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surfaceAuthErrorIfAny: vi.fn().mockResolvedValue(false)
}));

vi.mock("@/lib/auth/surface-auth-error", () => ({
  surfaceAuthErrorIfAny: mocks.surfaceAuthErrorIfAny
}));

import {
  addUserToGroup,
  fetchUserDetail,
  removeUserFromGroup,
  resetUserPassword,
  searchUsers,
  userMutationErrorLabel
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

function lastCall(): { url: string; init?: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: call[1] as RequestInit | undefined };
}

const SAMPLE_ROW = {
  user_id: "user-1",
  username: "alice@example.com",
  email: "alice@example.com",
  email_verified: true,
  status: "CONFIRMED",
  enabled: true,
  created_at: "2026-05-10T00:00:00Z",
  updated_at: "2026-05-10T00:00:00Z"
};

const SAMPLE_DETAIL = {
  ...SAMPLE_ROW,
  groups: ["signal-analytics-admin"],
  is_admin: true,
  profile: {
    subscription_plan: "pro",
    trading_mode: "paper",
    onboarding_completed: true,
    onboarding_completed_at: "2026-05-09T00:00:00Z",
    legal_acknowledged: true,
    legal_acknowledged_at: "2026-05-09T00:00:00Z",
    legal_acknowledged_version: "v1",
    beta_full_access: false,
    beta_access_until: null,
    beta_access_granted_at: null,
    has_full_access: true,
    has_ai_explanations: true
  }
};

// ── searchUsers ───────────────────────────────────────────────────────────

describe("searchUsers", () => {
  test("empty query fires fetch without q param (list-all behaviour)", async () => {
    // Contract change vs the original "show after typing" UX: the
    // Admin Users page now lists everyone by default, so an empty
    // query is a *valid* request that asks Cognito for the full pool
    // (paginated upstream). The client MUST hit the BFF, not
    // short-circuit.
    fetchMock.mockResolvedValue(
      jsonResponse({
        query: "",
        limit: 25,
        items: [SAMPLE_ROW],
        next_token: null
      })
    );
    const result = await searchUsers("   ");
    expect(fetchMock).toHaveBeenCalled();
    const { url } = lastCall();
    // No q= in the URL when query is blank.
    expect(url).not.toContain("q=");
    expect(url).toContain("limit=25");
    expect(result?.items).toHaveLength(1);
    expect(result?.next_token).toBeNull();
  });

  test("happy path forwards the query and parses items + next_token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        query: "ali",
        limit: 25,
        items: [SAMPLE_ROW],
        next_token: "tok-2"
      })
    );
    const result = await searchUsers("ali", { limit: 10 });
    expect(result?.items).toHaveLength(1);
    expect(result?.items[0]).toMatchObject({
      user_id: "user-1",
      email: "alice@example.com"
    });
    expect(result?.next_token).toBe("tok-2");
    const { url, init } = lastCall();
    expect(url).toBe("/api/stocvest/admin/users/search?q=ali&limit=10");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("include");
  });

  test("forwards page_token verbatim when provided", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ query: "", limit: 25, items: [], next_token: null })
    );
    await searchUsers("", { pageToken: "opaque-token-from-prev" });
    const { url } = lastCall();
    expect(url).toContain("page_token=opaque-token-from-prev");
  });

  test("empty / whitespace page_token is dropped (Cognito chokes on blanks)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ query: "", limit: 25, items: [], next_token: null })
    );
    await searchUsers("", { pageToken: "   " });
    expect(lastCall().url).not.toContain("page_token");
  });

  test("next_token of empty string normalises to null", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        query: "",
        limit: 25,
        items: [],
        next_token: ""
      })
    );
    const result = await searchUsers("");
    // The UI checks `next_token !== null` to decide whether the
    // "Next page" button is enabled — an empty string would falsely
    // enable it.
    expect(result?.next_token).toBeNull();
  });

  test("401 surfaces auth error and returns null", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    const result = await searchUsers("ali");
    expect(result).toBeNull();
    expect(mocks.surfaceAuthErrorIfAny).toHaveBeenCalled();
  });

  test("non-2xx returns null without throwing", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    expect(await searchUsers("ali")).toBeNull();
  });

  test("malformed payload returns null", async () => {
    fetchMock.mockResolvedValue(jsonResponse("not a record"));
    expect(await searchUsers("ali")).toBeNull();
  });

  test("filters out rows missing user_id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [SAMPLE_ROW, { email: "nobody@example.com" }, null]
      })
    );
    const result = await searchUsers("ali");
    expect(result?.items).toHaveLength(1);
  });

  test("network error returns null", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect(await searchUsers("ali")).toBeNull();
  });
});

// ── fetchUserDetail ───────────────────────────────────────────────────────

describe("fetchUserDetail", () => {
  test("empty user_id returns null without firing fetch", async () => {
    expect(await fetchUserDetail("  ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("happy path parses the full detail payload", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_DETAIL));
    const result = await fetchUserDetail("user-1");
    expect(result?.is_admin).toBe(true);
    expect(result?.groups).toEqual(["signal-analytics-admin"]);
    expect(result?.profile.subscription_plan).toBe("pro");
    expect(lastCall().url).toBe("/api/stocvest/admin/users/user-1");
  });

  test("url-encodes user_id (handles colons and pluses)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(SAMPLE_DETAIL));
    await fetchUserDetail("aws:cognito+special");
    expect(lastCall().url).toBe(
      "/api/stocvest/admin/users/aws%3Acognito%2Bspecial"
    );
  });

  test("404 returns null (user not in Cognito)", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    expect(await fetchUserDetail("missing")).toBeNull();
  });

  test("defaults plan/trading_mode when profile missing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...SAMPLE_DETAIL, profile: {} })
    );
    const result = await fetchUserDetail("user-1");
    expect(result?.profile.subscription_plan).toBe("free");
    expect(result?.profile.trading_mode).toBe("paper");
  });
});

// ── resetUserPassword ─────────────────────────────────────────────────────

describe("resetUserPassword", () => {
  test("happy path returns ok outcome with parsed data", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        user_id: "user-1",
        username: "alice@example.com",
        message: "Reset email sent."
      })
    );
    const outcome = await resetUserPassword("user-1");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.data.message).toBe("Reset email sent.");
    }
    const { url, init } = lastCall();
    expect(url).toBe(
      "/api/stocvest/admin/users/user-1/reset-password"
    );
    expect(init?.method).toBe("POST");
  });

  test("upstream 403 returns error outcome with code", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "forbidden", message: "Admin only." }, { status: 403 })
    );
    const outcome = await resetUserPassword("user-1");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(403);
      expect(outcome.code).toBe("forbidden");
    }
  });

  test("empty user_id short-circuits with bad_request", async () => {
    const outcome = await resetUserPassword("   ");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("bad_request");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("network failure returns network_error outcome", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const outcome = await resetUserPassword("user-1");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("network_error");
    }
  });
});

// ── addUserToGroup / removeUserFromGroup ──────────────────────────────────

describe("group mutations", () => {
  test("addUserToGroup hits POST", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        user_id: "user-1",
        group: "signal-analytics-admin",
        action: "add",
        groups: ["signal-analytics-admin"],
        is_admin: true
      })
    );
    const outcome = await addUserToGroup("user-1", "signal-analytics-admin");
    expect(outcome.kind).toBe("ok");
    const { url, init } = lastCall();
    expect(url).toBe(
      "/api/stocvest/admin/users/user-1/groups/signal-analytics-admin"
    );
    expect(init?.method).toBe("POST");
  });

  test("removeUserFromGroup hits DELETE", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        user_id: "user-1",
        group: "signal-analytics-admin",
        action: "remove",
        groups: [],
        is_admin: false
      })
    );
    const outcome = await removeUserFromGroup(
      "user-1",
      "signal-analytics-admin"
    );
    expect(outcome.kind).toBe("ok");
    expect(lastCall().init?.method).toBe("DELETE");
  });

  test("400 on bad group passes through code", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "bad_request", message: "Group not assignable" }, { status: 400 })
    );
    const outcome = await addUserToGroup("user-1", "not-a-real-group");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(400);
      expect(outcome.code).toBe("bad_request");
    }
  });

  test("malformed mutation response is reported as malformed_response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const outcome = await addUserToGroup("user-1", "signal-analytics-admin");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("malformed_response");
    }
  });

  test("empty inputs short-circuit", async () => {
    const a = await addUserToGroup("", "g");
    const b = await removeUserFromGroup("u", "");
    expect(a.kind).toBe("error");
    expect(b.kind).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── userMutationErrorLabel ────────────────────────────────────────────────

describe("userMutationErrorLabel", () => {
  test("maps every known code to a non-empty string", () => {
    for (const code of [
      "forbidden",
      "not_found",
      "bad_request",
      "internal_error",
      "network_error",
      "malformed_response",
      "anything_else"
    ]) {
      expect(userMutationErrorLabel(code).length).toBeGreaterThan(0);
    }
  });
});
