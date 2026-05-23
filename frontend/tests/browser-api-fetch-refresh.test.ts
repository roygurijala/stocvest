import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Sliding-session contract for `browserApiFetch`:
 *
 *   - On 401, attempt `refreshSession()` first.
 *   - If refresh succeeds, retry the original request **once** with the freshly-rewritten
 *     `stocvest_ws_token` cookie. The user never sees the calm banner for that path.
 *   - If refresh fails — OR the retry also returns 401 — fire `markSessionExpired("auth_error")`.
 *
 * `markSessionExpired` and `refreshSession` are both module-level singletons; we mock them so
 * we can assert the exact call sequence without spinning up a real `/api/auth/refresh` handler.
 */

// `vi.mock` is hoisted above all top-level declarations, so the factories cannot reference
// a plain `const` defined here — that would land us in the TDZ. `vi.hoisted` is the supported
// way to share mock instances between the factories and the test bodies.
const { readWsTokenMock, refreshSessionMock, markSessionExpiredMock } = vi.hoisted(() => ({
  readWsTokenMock: vi.fn(() => "test-token" as string | null),
  refreshSessionMock: vi.fn(async () => true),
  markSessionExpiredMock: vi.fn()
}));

vi.mock("@/lib/auth/ws-token-cookie", () => ({
  readWsTokenFromDocumentCookie: readWsTokenMock
}));
vi.mock("@/lib/auth/refresh-session", () => ({
  refreshSession: refreshSessionMock
}));
vi.mock("@/lib/auth/session-expired", () => ({
  markSessionExpired: markSessionExpiredMock
}));

import { browserApiFetch } from "@/lib/api/browser-api-fetch";

describe("browserApiFetch — 401 refresh-and-retry contract", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    readWsTokenMock.mockReset();
    readWsTokenMock.mockReturnValue("test-token");
    refreshSessionMock.mockReset();
    refreshSessionMock.mockResolvedValue(true);
    markSessionExpiredMock.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("happy path — 200 returns parsed JSON without touching the refresh path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await browserApiFetch<{ ok: boolean }>("/v1/whoami");
    expect(result).toEqual({ ok: true });
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(markSessionExpiredMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("401 then refresh success then 200 — original request is retried, banner is not shown", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, retried: true }), { status: 200 })
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await browserApiFetch<{ ok: boolean; retried: boolean }>("/v1/whoami");
    expect(result).toEqual({ ok: true, retried: true });
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(markSessionExpiredMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("401 then refresh failure — marks session expired and does NOT retry", async () => {
    refreshSessionMock.mockResolvedValue(false);
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await browserApiFetch<unknown>("/v1/whoami");
    expect(result).toBeNull();
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(markSessionExpiredMock).toHaveBeenCalledWith("auth_error");
    // Exactly one network call — we did NOT retry the original request when the refresh failed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("401 then refresh success then retry also returns 401 — marks expired defensively", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 401 }))
      .mockResolvedValueOnce(new Response("still no", { status: 401 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await browserApiFetch<unknown>("/v1/whoami");
    expect(result).toBeNull();
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(markSessionExpiredMock).toHaveBeenCalledWith("auth_error");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("403 is NOT treated as auth failure (product-rule denial — never refresh, never expire)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await browserApiFetch<unknown>("/v1/orders/submit");
    expect(result).toBeNull();
    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(markSessionExpiredMock).not.toHaveBeenCalled();
  });

  test("returns null when fetch does not return a promise (e.g. unconfigured test mock)", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;

    const result = await browserApiFetch<unknown>("/v1/market/earnings");
    expect(result).toBeNull();
    expect(refreshSessionMock).not.toHaveBeenCalled();
  });
});
