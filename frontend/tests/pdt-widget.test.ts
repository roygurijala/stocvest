import { describe, expect, test } from "vitest";
import { getPdtWarningMessage } from "@/components/pdt-status-widget";

describe("pdt widget warning messaging", () => {
  test("warns clearly at two day trades", () => {
    const message = getPdtWarningMessage({
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
    expect(message).toContain("2 day trades");
  });

  test("shows blocked message at limit", () => {
    const message = getPdtWarningMessage({
      user_id: "u1",
      assessment: {
        pdt_exempt: false,
        day_trades_in_window: 3,
        current_day_trade_count: 3,
        max_non_exempt: 3,
        rolling_business_days: 5,
        allow_next_day_trade: false,
        warn_near_limit: false,
        at_limit: true,
        days_until_reset: 1
      }
    });
    expect(message).toContain("blocked");
  });
});
