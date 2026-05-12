/**
 * Lock-in tests for `enrichEvidenceWithComposite` mode routing.
 *
 * These tests prove the wiring fix that resolved the cross-mode data leakage where
 * the dashboard Swing Desk row and scanner gap/setup cards silently called the day
 * composite engine regardless of the row's trading mode. The behavioral contract
 * pinned here:
 *
 * 1. `mode === "swing"` → POSTs to `/api/stocvest/signals/composite/swing`.
 * 2. `mode === "day"`   → POSTs to `/api/stocvest/signals/composite/real`.
 * 3. The deprecated `enrichEvidenceWithRealComposite` alias still hits the day
 *    route so existing third-party callers don't silently break, but the new code
 *    must NEVER use it.
 * 4. The symbol payload is forwarded verbatim (upper-cased) and credentials are
 *    `same-origin` so the BFF can attach the Cognito session cookie.
 *
 * If any of these assertions fails, the regression is the same shape as the one
 * that produced this fix: a swing-tagged row silently inherited day-engine output.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  buildEvidenceFromSetup,
  enrichEvidenceWithComposite,
  enrichEvidenceWithRealComposite
} from "@/lib/signal-evidence";
import type { IntradaySetupPayload } from "@/lib/api/scanner";

const baseSetup: IntradaySetupPayload = {
  symbol: "AAPL",
  direction: "long",
  score: 0.65,
  triggers: ["test"],
  timestamp_iso: new Date().toISOString()
};

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function installFetchSpy(responseBody: Record<string, unknown> = { mode: "swing", status: "ok" }): {
  calls: FetchCall[];
  spy: ReturnType<typeof vi.fn>;
} {
  const calls: FetchCall[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    calls.push({ url, init });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return { calls, spy };
}

describe("enrichEvidenceWithComposite mode routing", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("swing mode posts to /api/stocvest/signals/composite/swing", async () => {
    const { calls } = installFetchSpy({ mode: "swing", status: "ok" });
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    await enrichEvidenceWithComposite(base, "swing");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/stocvest/signals/composite/swing");
  });

  test("day mode posts to /api/stocvest/signals/composite/real", async () => {
    const { calls } = installFetchSpy({ mode: "day", status: "ok" });
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    await enrichEvidenceWithComposite(base, "day");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/stocvest/signals/composite/real");
  });

  test("never hits the wrong route — swing call must not reach /composite/real", async () => {
    const { calls } = installFetchSpy({ mode: "swing", status: "ok" });
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    await enrichEvidenceWithComposite(base, "swing");
    expect(calls.some((c) => c.url.includes("/composite/real"))).toBe(false);
  });

  test("never hits the wrong route — day call must not reach /composite/swing", async () => {
    const { calls } = installFetchSpy({ mode: "day", status: "ok" });
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    await enrichEvidenceWithComposite(base, "day");
    expect(calls.some((c) => c.url.includes("/composite/swing"))).toBe(false);
  });

  test("forwards upper-cased symbol payload and uses same-origin credentials", async () => {
    const { calls } = installFetchSpy({ mode: "swing", status: "ok" });
    const base = buildEvidenceFromSetup({ ...baseSetup, symbol: "tsla" }, undefined, { symbolNewsArticles: [] });
    await enrichEvidenceWithComposite(base, "swing");
    expect(calls).toHaveLength(1);
    const init = calls[0].init ?? {};
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    const body = init.body ? JSON.parse(String(init.body)) : {};
    expect(body).toEqual({ symbol: "TSLA" });
    expect((init.headers as Record<string, string> | undefined)?.["content-type"]).toBe("application/json");
  });

  test("returns evidence unchanged (with insight fallback) when symbol is empty", async () => {
    const { spy } = installFetchSpy();
    const base = buildEvidenceFromSetup({ ...baseSetup, symbol: "   " }, undefined, { symbolNewsArticles: [] });
    const out = await enrichEvidenceWithComposite(base, "swing");
    expect(spy).not.toHaveBeenCalled();
    expect(out.symbol).toBe(base.symbol);
  });

  test("returns evidence with insight fallback when fetch throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const out = await enrichEvidenceWithComposite(base, "swing");
    expect(out.insight).toBeTruthy();
    expect(out.symbol).toBe(base.symbol);
  });

  test("returns evidence with insight fallback when response is non-OK", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    const out = await enrichEvidenceWithComposite(base, "swing");
    expect(out.insight).toBeTruthy();
    expect(out.symbol).toBe(base.symbol);
  });

  test("deprecated enrichEvidenceWithRealComposite still routes to the day engine", async () => {
    const { calls } = installFetchSpy({ mode: "day", status: "ok" });
    const base = buildEvidenceFromSetup(baseSetup, undefined, { symbolNewsArticles: [] });
    await enrichEvidenceWithRealComposite(base);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/stocvest/signals/composite/real");
  });
});
