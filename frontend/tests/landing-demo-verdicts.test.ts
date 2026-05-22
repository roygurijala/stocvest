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

  test("unknown symbol gets generic limited preview", () => {
    const v = genericLandingDemoVerdict("AMD");
    expect(v.symbol).toBe("AMD");
    expect(v.limitedPreview).toBe(true);
    expect(v.execution).toMatch(/sign up for live/i);
  });
});
