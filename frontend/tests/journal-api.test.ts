import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("journal API client", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("fetchJournalEntries requests list endpoint", async () => {
    const { fetchJournalEntries } = await import("@/lib/api/journal");
    apiFetchMock.mockResolvedValueOnce([]);
    const rows = await fetchJournalEntries();
    expect(apiFetchMock).toHaveBeenCalledWith("/v1/journal/entries");
    expect(rows).toEqual([]);
  });

  test("createJournalEntry posts payload", async () => {
    const { createJournalEntry } = await import("@/lib/api/journal");
    apiFetchMock.mockResolvedValueOnce({ entry_id: "j-1" });
    await createJournalEntry({
      entry_id: "j-1",
      symbol: "AAPL",
      opening_side: "buy",
      quantity: 1,
      is_day_trade: true
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/v1/journal/entries",
      expect.objectContaining({ method: "POST" })
    );
  });

  test("fetchJournalAnalytics requests analytics endpoint", async () => {
    const { fetchJournalAnalytics } = await import("@/lib/api/journal");
    apiFetchMock.mockResolvedValueOnce({ user_id: "u1", total_trades: 0, win_rate: 0, disclaimer: "x" });
    const row = await fetchJournalAnalytics();
    expect(apiFetchMock).toHaveBeenCalledWith("/v1/journal/analytics");
    expect(row?.user_id).toBe("u1");
  });

  test("fetchJournalEntries passes status query", async () => {
    const { fetchJournalEntries } = await import("@/lib/api/journal");
    apiFetchMock.mockResolvedValueOnce([]);
    await fetchJournalEntries({ status: "closed", limit: 50 });
    expect(apiFetchMock).toHaveBeenCalledWith("/v1/journal/entries?status=closed&limit=50");
  });
});
