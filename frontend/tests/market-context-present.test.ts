import { describe, expect, test } from "vitest";
import {
  marketContextHeadline,
  parseMarketContextDampening,
  parseMarketContextFlags
} from "@/lib/signal-evidence/market-context-present";

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

describe("parseMarketContextDampening", () => {
  test("parses structured dampening payload", () => {
    const d = parseMarketContextDampening({
      market_context_dampening: {
        active: true,
        reason: "index_inclusion_window",
        trigger: "SpaceX",
        window_end: "2026-07-17",
        confidence_level: "reduced",
        undampened_score: 79,
        adjusted_score: 71,
        dampened_layers: [
          { layer: "sector", multiplier: 0.55, original_contribution: 0.14, adjusted_contribution: 0.077 }
        ]
      }
    });
    expect(d?.active).toBe(true);
    expect(d?.adjusted_score).toBe(71);
    expect(d?.dampened_layers[0]?.layer).toBe("sector");
  });
});
