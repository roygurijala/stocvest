import { afterEach, describe, expect, it, vi } from "vitest";

import {
  primeWatchlistSymbolMaturation,
  refreshWatchlistSymbolMaturationDesk
} from "@/lib/watchlist-maturation-prime";
import { consumeWatchlistMaturationBump } from "@/lib/watchlist-maturation-bump";

describe("primeWatchlistSymbolMaturation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("POSTs swing composite only when dualDesk is false", async () => {
    const urls: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      urls.push(typeof input === "string" ? input : input.toString());
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;

    await primeWatchlistSymbolMaturation("aapl", false);

    expect(urls.some((u) => u.includes("/composite/swing"))).toBe(true);
    expect(urls.some((u) => u.includes("/composite/real"))).toBe(false);
  });

  it("POSTs swing and day when dualDesk is true", async () => {
    const urls: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      urls.push(typeof input === "string" ? input : input.toString());
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as unknown as typeof fetch;

    await primeWatchlistSymbolMaturation("nvda", true);

    expect(urls.some((u) => u.includes("/composite/swing"))).toBe(true);
    expect(urls.some((u) => u.includes("/composite/real"))).toBe(true);
  });

  it("refreshWatchlistSymbolMaturationDesk bumps maturation on success", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({}) })
    ) as unknown as typeof fetch;

    const ok = await refreshWatchlistSymbolMaturationDesk("AMZN", "swing");
    expect(ok).toBe(true);
    expect(consumeWatchlistMaturationBump()).toBe(true);
  });
});
