/**
 * Tests for `upsertHoldingClient` in `frontend/lib/api/fetch-holdings-client.ts`.
 * Pins the typed result contract so a failed save surfaces the real HTTP status +
 * backend message (not the old generic "Check the values") — the reason is usually
 * the write path being unavailable, not the user's input.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { upsertHoldingClient } from "@/lib/api/fetch-holdings-client";
import type { HoldingInput } from "@/lib/portfolio/types";

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

const INPUT: HoldingInput = {
  symbol: "ARKQ",
  lots: [{ lotId: "a", quantity: 92, costBasis: 91.86, purchaseDate: "2025-07-14" }]
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof global.fetch;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("upsertHoldingClient", () => {
  test("PUTs the holding and returns ok with the stored holding", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ symbol: "ARKQ", totalQuantity: 100, averageCost: 91.87, lots: [] })
    });

    const result = await upsertHoldingClient(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/stocvest/holdings");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual(INPUT);
    expect(result).toEqual({
      ok: true,
      holding: { symbol: "ARKQ", totalQuantity: 100, averageCost: 91.87, lots: [] }
    });
  });

  test("surfaces the backend message + status on a validation reject (400)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "bad_request", message: "Invalid holding: lotId is required." })
    });

    const result = await upsertHoldingClient(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe("Invalid holding: lotId is required.");
    }
  });

  test("explains a 403 as signed-out / service-unavailable, not a data problem", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ message: "Missing Authentication Token" })
    });

    const result = await upsertHoldingClient(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.message).toContain("HTTP 403");
      expect(result.message.toLowerCase()).toContain("isn't available");
    }
  });

  test("returns a connection message when the request never reaches the server", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));

    const result = await upsertHoldingClient(INPUT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.message.toLowerCase()).toContain("couldn't reach the server");
    }
  });
});
