import { afterEach, describe, expect, it, vi } from "vitest";

import { primeWatchlistSymbolMaturation } from "@/lib/watchlist-maturation-prime";

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
});
