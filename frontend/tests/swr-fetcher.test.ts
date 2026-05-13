/**
 * Tier 1 → Layer 4 — `swrFetcher` lock-in tests.
 *
 * See `docs/PERFORMANCE.md` §1 layer 4 + §4C and
 * `lib/swr/fetcher.ts` for the rationale doc-block.
 *
 * What we lock in:
 *
 *   * 2xx response → resolves with parsed JSON body.
 *   * Non-2xx response → throws `SwrFetcherError` carrying the
 *     status code AND the parsed body (when JSON).
 *   * 401 response → calls `surfaceAuthErrorIfAny` (so the
 *     session-expired banner fires) AND throws — SWR needs the
 *     error to land in the hook's `error` slot.
 *   * Always sends `credentials: "include"` (HttpOnly cookies)
 *     and `accept: application/json`.
 */

import { describe, expect, test, vi, beforeEach } from "vitest";

import { swrFetcher, SwrFetcherError } from "@/lib/swr/fetcher";

const surfaceMock = vi.fn();
vi.mock("@/lib/auth/surface-auth-error", () => ({
  surfaceAuthErrorIfAny: (res: Response) => surfaceMock(res)
}));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  surfaceMock.mockReset();
  globalThis.fetch = originalFetch;
});

function mockFetch(response: Partial<Response> & { jsonBody?: unknown }) {
  const json =
    "jsonBody" in response
      ? async () => response.jsonBody
      : async () => {
          throw new Error("no body");
        };
  const fake = {
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: response.statusText ?? "OK",
    json
  } as unknown as Response;
  globalThis.fetch = vi.fn().mockResolvedValue(fake) as unknown as typeof fetch;
  return fake;
}

describe("swrFetcher", () => {
  test("resolves with parsed JSON on 2xx", async () => {
    mockFetch({ ok: true, status: 200, jsonBody: { hello: "world" } });
    const result = await swrFetcher<{ hello: string }>(
      "/api/stocvest/test-endpoint"
    );
    expect(result).toEqual({ hello: "world" });
  });

  test("sends credentials + JSON accept header", async () => {
    mockFetch({ ok: true, status: 200, jsonBody: {} });
    await swrFetcher("/api/stocvest/test-endpoint");
    const callArgs = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(callArgs[0]).toBe("/api/stocvest/test-endpoint");
    const init = callArgs[1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).accept).toBe(
      "application/json"
    );
  });

  test("throws SwrFetcherError on non-2xx with status + body", async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: "Server Error",
      jsonBody: { error: "boom" }
    });
    await expect(swrFetcher("/api/stocvest/x")).rejects.toMatchObject({
      name: "SwrFetcherError",
      status: 500,
      body: { error: "boom" }
    });
  });

  test("on 401 fires surfaceAuthErrorIfAny AND throws", async () => {
    mockFetch({ ok: false, status: 401, statusText: "Unauthorized" });
    await expect(swrFetcher("/api/stocvest/x")).rejects.toBeInstanceOf(
      SwrFetcherError
    );
    expect(surfaceMock).toHaveBeenCalledTimes(1);
  });

  test("does NOT fire surfaceAuthErrorIfAny on 200", async () => {
    mockFetch({ ok: true, status: 200, jsonBody: {} });
    await swrFetcher("/api/stocvest/x");
    expect(surfaceMock).not.toHaveBeenCalled();
  });

  test("does NOT fire surfaceAuthErrorIfAny on 500", async () => {
    mockFetch({ ok: false, status: 500 });
    await expect(swrFetcher("/api/stocvest/x")).rejects.toBeDefined();
    expect(surfaceMock).not.toHaveBeenCalled();
  });

  test("SwrFetcherError has a useful default message including the URL", async () => {
    mockFetch({ ok: false, status: 404, statusText: "Not Found" });
    try {
      await swrFetcher("/api/stocvest/missing");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SwrFetcherError);
      expect((err as Error).message).toContain("/api/stocvest/missing");
      expect((err as Error).message).toContain("404");
    }
  });
});
