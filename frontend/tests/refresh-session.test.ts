import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { __resetRefreshSessionForTests, refreshSession } from "@/lib/auth/refresh-session";

/**
 * These tests pin the sliding-session client contract:
 *
 *   - `refreshSession()` POSTs to `/api/auth/refresh` and returns `true` on 200, `false` otherwise.
 *   - Parallel callers are coalesced onto a single in-flight POST (no refresh storms).
 *   - After a failure, subsequent calls short-circuit during the cooldown window (no hammer
 *     loops when a hard-expired refresh token surfaces from five parallel 401s).
 *
 * These guarantees are the only thing standing between "calm sliding session" and "five
 * concurrent Cognito refresh calls every time the JWT rotates".
 */

describe("refreshSession", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    __resetRefreshSessionForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    __resetRefreshSessionForTests();
  });

  test("returns true on a 200 from /api/auth/refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }), { status: 200 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const ok = await refreshSession();
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/refresh",
      expect.objectContaining({ method: "POST", credentials: "include" })
    );
  });

  test("returns false on a 401 from /api/auth/refresh (refresh token expired)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "refresh_failed" }), { status: 401 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const ok = await refreshSession();
    expect(ok).toBe(false);
  });

  test("returns false on a network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    global.fetch = fetchMock as unknown as typeof fetch;

    const ok = await refreshSession();
    expect(ok).toBe(false);
  });

  test("coalesces parallel callers onto a single in-flight POST", async () => {
    // Hold the resolver so all five callers race onto the same promise before it settles.
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const calls = Promise.all([
      refreshSession(),
      refreshSession(),
      refreshSession(),
      refreshSession(),
      refreshSession()
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }), { status: 200 })
    );
    const results = await calls;
    expect(results).toEqual([true, true, true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("short-circuits subsequent calls during the cooldown window after a failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "refresh_failed" }), { status: 401 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await refreshSession();
    expect(first).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Two more callers inside the cooldown — they must NOT hit the network.
    const second = await refreshSession();
    const third = await refreshSession();
    expect(second).toBe(false);
    expect(third).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
