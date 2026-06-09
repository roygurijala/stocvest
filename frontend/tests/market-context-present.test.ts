import { describe, expect, test } from "vitest";
import { marketContextHeadline, parseMarketContextFlags } from "@/lib/signal-evidence/market-context-present";

describe("parseMarketContextFlags", () => {
  test("returns null when flags absent or empty", () => {
    expect(parseMarketContextFlags(null)).toBeNull();
    expect(parseMarketContextFlags({})).toBeNull();
    expect(parseMarketContextFlags({ market_context_flags: {} })).toBeNull();
  });

  test("parses unseasoned listing warnings", () => {
    const flags = parseMarketContextFlags({
      market_context_flags: {
        ipo_unseasoned: true,
        listed_days: 12,
        warnings: ["New listing (under 90 sessions) — gap volume may reflect IPO discovery or index flows, not organic conviction."]
      }
    });
    expect(flags?.ipo_unseasoned).toBe(true);
    expect(flags?.listed_days).toBe(12);
    expect(flags?.warnings).toHaveLength(1);
    expect(marketContextHeadline(flags!)).toMatch(/New listing/i);
  });

  test("parses ecosystem exposure", () => {
    const flags = parseMarketContextFlags({
      market_context_flags: {
        ecosystem_entity: "SpaceX",
        ecosystem_role: "corporate_backer",
        warnings: ["IPO ecosystem exposure (SpaceX): Alphabet stake repricing proxy"]
      }
    });
    expect(flags?.ecosystem_entity).toBe("SpaceX");
    expect(flags?.ecosystem_role).toBe("corporate_backer");
  });
});
