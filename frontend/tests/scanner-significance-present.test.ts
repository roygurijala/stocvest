import { describe, expect, test } from "vitest";
import { scannerSignificanceLabel } from "@/lib/scanner-significance-present";

describe("scannerSignificanceLabel", () => {
  test("maps numeric significance to qualitative labels", () => {
    expect(scannerSignificanceLabel(90)).toBe("high significance");
    expect(scannerSignificanceLabel(60)).toBe("moderate significance");
    expect(scannerSignificanceLabel(20)).toBe("low significance");
  });
});
