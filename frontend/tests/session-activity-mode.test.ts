import { describe, expect, test } from "vitest";
import {
  resolveSessionActivityUiMode,
  sessionActivityClosedSummary
} from "@/lib/market/session-activity-mode";

describe("session-activity-mode", () => {
  test("resolveSessionActivityUiMode live when market open", () => {
    expect(resolveSessionActivityUiMode({ market: "open", exchanges: {}, currencies: {} })).toBe("live");
  });

  test("resolveSessionActivityUiMode closed when market closed", () => {
    expect(resolveSessionActivityUiMode({ market: "closed", exchanges: {}, currencies: {} })).toBe("closed");
  });

  test("resolveSessionActivityUiMode live when status missing", () => {
    expect(resolveSessionActivityUiMode(null)).toBe("live");
  });

  test("resolveSessionActivityUiMode extended for extended-hours", () => {
    expect(
      resolveSessionActivityUiMode({ market: "extended-hours", exchanges: {}, currencies: {} })
    ).toBe("extended");
  });

  test("sessionActivityClosedSummary", () => {
    expect(sessionActivityClosedSummary(15)).toContain("15 movers");
    expect(sessionActivityClosedSummary(1)).toContain("1 mover");
  });
});
