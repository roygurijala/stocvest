import { describe, expect, test } from "vitest";
import {
  genericLandingDemoVerdict,
  resolveLandingDemoVerdict
} from "@/lib/landing/demo-verdicts";

describe("landing demo verdicts", () => {
  test("curated NFLX is not actionable", () => {
    const v = resolveLandingDemoVerdict("nflx");
    expect(v?.symbol).toBe("NFLX");
    expect(v?.actionable).toBe(false);
    expect(v?.bias).toBe("Bearish");
  });

  test("unknown symbol gets generic preview", () => {
    const v = genericLandingDemoVerdict("xyz");
    expect(v.symbol).toBe("XYZ");
    expect(v.execution).toMatch(/sign up for live/i);
  });
});
