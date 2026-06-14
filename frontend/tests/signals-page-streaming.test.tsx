import { describe, expect, test } from "vitest";

/**
 * Legacy `/dashboard/signals` now redirects to Trading Room deep-dive.
 */
describe("signals legacy route", () => {
  test("loading route is a no-op placeholder", async () => {
    const mod = await import("@/app/dashboard/signals/loading");
    expect(mod.default).toBeTypeOf("function");
  });
});
