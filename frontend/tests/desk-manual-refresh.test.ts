import { describe, expect, test, beforeEach } from "vitest";

import {
  canDeskManualRefreshNow,
  deskManualRefreshCooldownRemainingMs,
  formatCooldownRemaining,
  markDeskManualRefreshAt,
  readDeskManualRefreshAt
} from "@/lib/dashboard/desk-manual-refresh";
import { DESK_MANUAL_REFRESH_COOLDOWN_MS } from "@/lib/dashboard/desk-refresh-tiers";

describe("desk manual refresh cooldown", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("allows refresh when never used", () => {
    expect(canDeskManualRefreshNow()).toBe(true);
    expect(deskManualRefreshCooldownRemainingMs()).toBe(0);
  });

  test("blocks refresh within cooldown window", () => {
    const now = 1_700_000_000_000;
    markDeskManualRefreshAt(now);
    expect(readDeskManualRefreshAt()).toBe(now);
    expect(canDeskManualRefreshNow(now + 60_000)).toBe(false);
    expect(deskManualRefreshCooldownRemainingMs(now + 60_000)).toBe(
      DESK_MANUAL_REFRESH_COOLDOWN_MS - 60_000
    );
  });

  test("formatCooldownRemaining", () => {
    expect(formatCooldownRemaining(125_000)).toBe("2m 5s");
    expect(formatCooldownRemaining(45_000)).toBe("45s");
  });
});
