/**
 * Pins the sale + ledger BFF paths used by My Portfolio advice tracking.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  fetchPortfolioLedgerClient,
  recordHoldingSaleClient
} from "@/lib/api/fetch-holdings-client";

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof global.fetch;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("recordHoldingSaleClient", () => {
  test("POSTs quantity, sale price, date, and cash credit to the per-symbol sale BFF", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sale: { kind: "sale" }, holding: { symbol: "WMT", totalQuantity: 6 } })
    });

    const result = await recordHoldingSaleClient("wmt", {
      quantity: 4,
      salePrice: 200,
      soldAt: "2026-09-14",
      creditCash: true
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/stocvest/holdings/wmt/sale");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      quantity: 4,
      salePrice: 200,
      soldAt: "2026-09-14",
      creditCash: true
    });
  });

  test("returns the backend message on a failed sale", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: "Sale quantity exceeds shares held." })
    });
    const result = await recordHoldingSaleClient("WMT", {
      quantity: 99,
      salePrice: 1,
      soldAt: "2026-09-14"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("exceeds");
  });
});

describe("fetchPortfolioLedgerClient", () => {
  test("GETs /holdings/ledger and parses events", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        count: 1,
        events: [{ kind: "sale", symbol: "WMT", occurredAt: "2026-09-14", realizedPl: 10 }],
        summary: { salesCount: 1, realizedPl: 10 }
      })
    });
    const ledger = await fetchPortfolioLedgerClient();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/stocvest/holdings/ledger");
    expect(ledger?.events[0].kind).toBe("sale");
    expect(ledger?.summary.salesCount).toBe(1);
  });

  test("returns null when the ledger route is not deployed", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    expect(await fetchPortfolioLedgerClient()).toBeNull();
  });
});
