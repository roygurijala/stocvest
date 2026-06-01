import { describe, expect, test, beforeEach } from "vitest";
import {
  readTradingModePreference,
  resolveTradingModeForSurfaces,
  TRADING_MODE_STORAGE_KEY,
  writeTradingModePreference
} from "@/lib/trading-mode-preference";

describe("trading-mode-preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("defaults to swing when unset", () => {
    expect(readTradingModePreference()).toBe("swing");
    expect(resolveTradingModeForSurfaces(true)).toBe("swing");
  });

  test("persists and restores day when day desk is available", () => {
    writeTradingModePreference("day");
    expect(readTradingModePreference()).toBe("day");
    expect(resolveTradingModeForSurfaces(true)).toBe("day");
  });

  test("falls back to swing when day desk is hidden", () => {
    writeTradingModePreference("day");
    expect(resolveTradingModeForSurfaces(false)).toBe("swing");
  });

  test("uses shared storage key with Signals", () => {
    localStorage.setItem(TRADING_MODE_STORAGE_KEY, "swing");
    expect(readTradingModePreference("day")).toBe("swing");
  });
});
