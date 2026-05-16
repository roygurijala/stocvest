import { beforeEach, describe, expect, test, vi } from "vitest";

const browserApiFetchMock = vi.fn();

vi.mock("@/lib/api/browser-api-fetch", () => ({
  browserApiFetch: browserApiFetchMock
}));

describe("fetchScannerEvaluationTraceClient", () => {
  beforeEach(() => {
    browserApiFetchMock.mockReset();
  });

  test("parses GET scanner-trace response", async () => {
    const { fetchScannerEvaluationTraceClient } = await import("@/lib/api/scanner-trace-client");
    browserApiFetchMock.mockResolvedValue({
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
    const rows = await fetchScannerEvaluationTraceClient("both", 20);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.symbol).toBe("NVDA");
    expect(browserApiFetchMock.mock.calls[0]?.[0]).toContain("/v1/signals/scanner-trace");
  });
});
