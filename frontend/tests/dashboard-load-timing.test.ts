import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { isDashboardLoadTimingEnabled, timeDashboardPhase } from "@/lib/dashboard/load-timing";

describe("dashboard load timing", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("isDashboardLoadTimingEnabled is false in production without flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STOCVEST_DASHBOARD_TIMING", "");
    expect(isDashboardLoadTimingEnabled()).toBe(false);
  });

  test("isDashboardLoadTimingEnabled is true when STOCVEST_DASHBOARD_TIMING=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STOCVEST_DASHBOARD_TIMING", "1");
    expect(isDashboardLoadTimingEnabled()).toBe(true);
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

  test("timeDashboardPhase logs when enabled", async () => {
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
