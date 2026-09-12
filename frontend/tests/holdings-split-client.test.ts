/**
 * Tests for `applyHoldingSplitClient` in `frontend/lib/api/fetch-holdings-client.ts`
 * (PORTFOLIO-MGMT Slice 1d). Pins the BFF path, the `{ ratio }` body, and the
 * null-on-failure contract.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { applyHoldingSplitClient } from "@/lib/api/fetch-holdings-client";

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof global.fetch;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("applyHoldingSplitClient", () => {
  test("POSTs the ratio to the per-symbol split BFF route and returns the holding", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ symbol: "AAPL", totalQuantity: 20, averageCost: 91, lots: [] })
    });

    const result = await applyHoldingSplitClient("aapl", 2);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/stocvest/holdings/aapl/split");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ ratio: 2 });
    expect(result?.totalQuantity).toBe(20);
  });

  test("returns null on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    expect(await applyHoldingSplitClient("AAPL", 2)).toBeNull();
  });

  test("returns null when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await applyHoldingSplitClient("AAPL", 2)).toBeNull();
  });
});
