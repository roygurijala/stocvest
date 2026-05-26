import { describe, expect, test } from "vitest";
import {
  DESK_DISCOVERY_DISPLAY_LIMIT,
  DESK_MANUAL_REFRESH_COOLDOWN_MS,
  DESK_REFRESH_TIER_A_MS,
  DESK_REFRESH_TIER_B_MS,
  deskRefreshIntervalMs,
  isUsEquityRth,
  shouldPollDeskTier
} from "@/lib/dashboard/desk-refresh-tiers";

describe("desk-refresh-tiers", () => {
  test("interval constants match master plan", () => {
    expect(DESK_REFRESH_TIER_A_MS).toBe(60_000);
    expect(DESK_REFRESH_TIER_B_MS).toBe(900_000);
    expect(DESK_MANUAL_REFRESH_COOLDOWN_MS).toBe(300_000);
    expect(DESK_DISCOVERY_DISPLAY_LIMIT).toBe(15);
  });

  test("deskRefreshIntervalMs maps tiers", () => {
    expect(deskRefreshIntervalMs("pulse")).toBe(60_000);
    expect(deskRefreshIntervalMs("movers")).toBe(900_000);
    expect(deskRefreshIntervalMs("discovery")).toBe(900_000);
  });

  test("shouldPollDeskTier pauses movers outside RTH", () => {
    const sat = new Date("2026-05-23T15:00:00Z");
    expect(shouldPollDeskTier("pulse", sat)).toBe(true);
    expect(shouldPollDeskTier("movers", sat)).toBe(false);
  });

  test("isUsEquityRth true mid-session ET", () => {
    const wed = new Date("2026-05-27T15:00:00Z");
    expect(isUsEquityRth(wed)).toBe(true);
  });
});
