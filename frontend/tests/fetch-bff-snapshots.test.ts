import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BFF_SNAPSHOT_BATCH_SIZE,
  fetchBffSnapshotsBatched,
  mergeSnapshotMaps
} from "@/lib/api/fetch-bff-snapshots";

describe("fetch-bff-snapshots", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("chunks requests at the BFF batch size", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      const symbols = new URL(url, "http://localhost").searchParams.get("symbols") ?? "";
      const count = symbols.split(",").filter(Boolean).length;
      return {
        ok: true,
        json: async () => ({
          snapshots: symbols.split(",").map((symbol) => ({ symbol, change_percent: count }))
        })
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const symbols = Array.from({ length: BFF_SNAPSHOT_BATCH_SIZE + 3 }, (_, i) => `S${i}`);
    const map = await fetchBffSnapshotsBatched(symbols);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(map.size).toBe(symbols.length);
    expect(map.get("S0")?.change_percent).toBe(BFF_SNAPSHOT_BATCH_SIZE);
    expect(map.get(`S${BFF_SNAPSHOT_BATCH_SIZE}`)?.change_percent).toBe(3);
  });

  it("merges parent and local snapshot maps with local winning", () => {
    const parent = new Map([["AAPL", { symbol: "AAPL", change_percent: 1 }]]);
    const local = new Map([["AAPL", { symbol: "AAPL", change_percent: 2 }], ["MSFT", { symbol: "MSFT", change_percent: -1 }]]);
    const merged = mergeSnapshotMaps(parent, local);
    expect(merged.get("AAPL")?.change_percent).toBe(2);
    expect(merged.get("MSFT")?.change_percent).toBe(-1);
  });
});
