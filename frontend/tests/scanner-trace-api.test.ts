import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("fetchScannerEvaluationTrace", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("parses GET scanner-trace response", async () => {
    const { fetchScannerEvaluationTrace } = await import("@/lib/api/scanner-trace");
    apiFetchMock.mockResolvedValue({
      session_date_et: "2026-05-16",
      mode: "both",
      disclaimer: "not a watchlist",
      evaluation_trace: [
        {
          symbol: "nvda",
          desk: "day",
          gate: "session_rvol",
          detail: "Session volume 10% below expected intraday pace",
          outcome: "did_not_qualify"
        }
      ]
    });
    const rows = await fetchScannerEvaluationTrace("both", 20);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.symbol).toBe("NVDA");
    expect(apiFetchMock.mock.calls[0]?.[0]).toContain("/v1/signals/scanner-trace");
  });
});
