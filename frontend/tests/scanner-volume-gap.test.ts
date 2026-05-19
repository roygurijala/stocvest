import { describe, expect, test } from "vitest";
import { volumeFillFromPctBelow, volumeGapAriaLabel } from "@/lib/scanner-volume-gap";

describe("scanner-volume-gap", () => {
  test("volumeFillFromPctBelow inverts below-threshold into fill", () => {
    expect(volumeFillFromPctBelow(12)).toBe(88);
    expect(volumeFillFromPctBelow(100)).toBe(0);
    expect(volumeFillFromPctBelow(0)).toBe(100);
  });

  test("volumeGapAriaLabel includes symbol and fill", () => {
    expect(volumeGapAriaLabel("SOFI", 88, 12)).toMatch(/SOFI/);
    expect(volumeGapAriaLabel("SOFI", 88, 12)).toMatch(/88%/);
  });
});
