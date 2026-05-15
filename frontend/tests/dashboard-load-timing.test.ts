import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import * as timingRedis from "@/lib/dashboard/dashboard-timing-redis";
import { resolveDashboardTimingEnabled, timeDashboardPhase } from "@/lib/dashboard/load-timing";

describe("dashboard load timing", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.spyOn(timingRedis, "readDashboardTimingToggleCached").mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("resolveDashboardTimingEnabled is false in production without env or redis", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STOCVEST_DASHBOARD_TIMING", "");
    await expect(resolveDashboardTimingEnabled()).resolves.toBe(false);
  });

  test("resolveDashboardTimingEnabled is true when STOCVEST_DASHBOARD_TIMING=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STOCVEST_DASHBOARD_TIMING", "1");
    await expect(resolveDashboardTimingEnabled()).resolves.toBe(true);
  });

  test("STOCVEST_DASHBOARD_TIMING=0 overrides redis toggle", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STOCVEST_DASHBOARD_TIMING", "0");
    vi.spyOn(timingRedis, "readDashboardTimingToggleCached").mockResolvedValue(true);
    await expect(resolveDashboardTimingEnabled()).resolves.toBe(false);
  });

  test("redis toggle on enables timing in production when env unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STOCVEST_DASHBOARD_TIMING", "");
    vi.spyOn(timingRedis, "readDashboardTimingToggleCached").mockResolvedValue(true);
    await expect(resolveDashboardTimingEnabled()).resolves.toBe(true);
  });

  test("timeDashboardPhase skips console when disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STOCVEST_DASHBOARD_TIMING", "");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const out = await timeDashboardPhase("noop", async () => 42);
    expect(out).toBe(42);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  test("timeDashboardPhase logs when enabled via env", async () => {
    vi.stubEnv("STOCVEST_DASHBOARD_TIMING", "1");
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await timeDashboardPhase("probe", async () => {
      return "ok";
    });
    expect(log).toHaveBeenCalledTimes(1);
    const msg = String(log.mock.calls[0]?.[0] ?? "");
    expect(msg).toMatch(/^\[dashboard-load\] probe \d+ms$/);
    log.mockRestore();
  });
});
