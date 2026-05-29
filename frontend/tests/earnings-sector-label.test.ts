import { describe, expect, test } from "vitest";
import { earningsSectorLabel } from "@/lib/earnings-sector-label";

describe("earningsSectorLabel", () => {
  test("maps known symbols", () => {
    expect(earningsSectorLabel("AAPL", "Apple Inc")).toBe("Tech");
    expect(earningsSectorLabel("DLNG", "Dynagas LNG Partners")).toBe("Energy");
  });

  test("infers from company name", () => {
    expect(earningsSectorLabel("ZZZZ", "Acme Oil & Gas Partners")).toBe("Energy");
  });

  test("returns dash when unknown", () => {
    expect(earningsSectorLabel("ZZZZ", "Acme Holdings")).toBe("—");
  });
});
