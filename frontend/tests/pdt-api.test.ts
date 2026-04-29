import { beforeEach, describe, expect, test, vi } from "vitest";

const apiFetchMock = vi.fn();

vi.mock("@/lib/api/client", () => ({
  apiFetch: apiFetchMock
}));

describe("pdt API client", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  test("fetchPdtStatus requests pdt status endpoint", async () => {
    const { fetchPdtStatus } = await import("@/lib/api/pdt");
    apiFetchMock.mockResolvedValueOnce({
      user_id: "u1",
      assessment: {
        pdt_exempt: false,
        day_trades_in_window: 2,
        current_day_trade_count: 2,
        max_non_exempt: 3,
        rolling_business_days: 5,
        allow_next_day_trade: true,
        warn_near_limit: true,
        at_limit: false,
        days_until_reset: 1
      }
    });
    const status = await fetchPdtStatus();
    expect(apiFetchMock).toHaveBeenCalledWith("/v1/pdt/status");
    expect(status.assessment.warn_near_limit).toBe(true);
  });
});
