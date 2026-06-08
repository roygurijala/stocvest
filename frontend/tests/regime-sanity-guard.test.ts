import { describe, expect, test } from "vitest";
import { applyRegimeSanityGuard, resolveRegimeLabel } from "@/lib/market-context/regime";

describe("applyRegimeSanityGuard", () => {
  test("overrides Neutral → Bearish on a sharply red tape", () => {
    expect(applyRegimeSanityGuard("Neutral", -2.6, -5.4)).toBe("Bearish");
  });

  test("overrides Neutral → Bearish when only QQQ is sharply red", () => {
    expect(applyRegimeSanityGuard("Neutral", -0.5, -2.5)).toBe("Bearish");
  });

  test("overrides Neutral → Bullish only when both indices are sharply green", () => {
    expect(applyRegimeSanityGuard("Neutral", 1.8, 2.4)).toBe("Bullish");
    expect(applyRegimeSanityGuard("Neutral", 1.8, 0.5)).toBe("Neutral");
  });

  test("leaves an already-directional label untouched", () => {
    expect(applyRegimeSanityGuard("Bullish", -5, -6)).toBe("Bullish");
    expect(applyRegimeSanityGuard("Bearish", 5, 6)).toBe("Bearish");
  });

  test("does not fire on a mild / mixed tape", () => {
    expect(applyRegimeSanityGuard("Neutral", -0.4, -0.8)).toBe("Neutral");
  });

  test("no-ops when index data is missing", () => {
    expect(applyRegimeSanityGuard("Neutral", null, null)).toBe("Neutral");
  });
});

describe("resolveRegimeLabel with guard", () => {
  test("a -5% QQQ day is never reported as Neutral even if the scanner says so", () => {
    const { label } = resolveRegimeLabel({
      scannerRegimeLabel: "Neutral",
      spyPct: -2.6,
      qqqPct: -5.4
    });
    expect(label).toBe("Bearish");
  });

  test("a genuinely flat tape stays Neutral", () => {
    const { label } = resolveRegimeLabel({
      scannerRegimeLabel: "Neutral",
      spyPct: 0.1,
      qqqPct: -0.1
    });
    expect(label).toBe("Neutral");
  });
});
