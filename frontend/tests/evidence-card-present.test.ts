import { describe, expect, test } from "vitest";
import type { EvidenceLayer } from "@/lib/signal-evidence";
import {
  buildEvidenceAnchorLine,
  countLayerAlignment,
  evidenceDirectionToBias,
  evidenceLayerToRow,
  evidenceLayersToRows,
  formatDriversStrip,
  pickPrimaryLayerDrivers
} from "@/lib/signal-evidence/evidence-card-present";
import { resolveCompositeLayerAlignment } from "@/lib/signals-page-present";

function layer(
  key: string,
  name: string,
  status: EvidenceLayer["status"],
  score: number
): EvidenceLayer {
  return {
    key,
    icon: "•",
    name,
    status,
    weightPercent: 16,
    explanation: "x",
    keyPoints: [],
    contributionScore: score
  };
}

describe("evidenceDirectionToBias", () => {
  test("maps short and bearish to Bearish", () => {
    expect(evidenceDirectionToBias("short")).toBe("Bearish");
    expect(evidenceDirectionToBias("bearish")).toBe("Bearish");
  });
});

describe("evidenceLayerToRow", () => {
  test("pending sector cache marks row unavailable and excluded from alignment", () => {
    const row = evidenceLayerToRow(
      Object.assign(layer("sector", "Sector", "Neutral", 45), {
        sector_resolution_state: "pending_cache_refresh" as const,
        sector_data_available: false
      })
    );
    expect(row.status).toBe("Unavailable");
    expect(row.sectorCachePending).toBe(true);
    expect(row.score).toBeNull();
    expect(row.statusLabel).toBe("Unavailable (not factored)");
  });

  test("pending sector still surfaces mapped benchmark label", () => {
    const row = evidenceLayerToRow(
      Object.assign(layer("sector", "Sector", "Neutral", 45), {
        sector_resolution_state: "pending_cache_refresh" as const,
        sector_etf: "ITA",
        sector_display_name: "Aerospace & Defense",
        sector_data_available: false
      })
    );
    expect(row.statusLabel).toBe("Aerospace & Defense (ITA) · resolving");
    const alignment = resolveCompositeLayerAlignment({
      rows: [
        ...evidenceLayersToRows([
          layer("technical", "Technical", "Neutral", 50),
          layer("news", "News", "Neutral", 43),
          layer("macro", "Macro", "Neutral", 46),
          row,
          layer("geopolitical", "Geopolitical", "Neutral", 58),
          layer("internals", "Market Internals", "Neutral", 37)
        ])
      ],
      bias: "Neutral",
      alignmentRatio: 0.5
    });
    expect(alignment.displayLine).toBe("Mixed direction (3/6)");
  });
});

describe("buildEvidenceAnchorLine", () => {
  test("bearish not aligned uses no valid setup copy", () => {
    const rows = evidenceLayersToRows([
      layer("technical", "Technical", "Bearish", 80),
      layer("news", "News", "Neutral", 50),
      layer("macro", "Macro", "Neutral", 50),
      layer("sector", "Sector", "Neutral", 50),
      layer("internals", "Market Internals", "Neutral", 50),
      layer("geopolitical", "Geopolitical", "Neutral", 50)
    ]);
    const alignment = countLayerAlignment(rows, "Bearish");
    expect(buildEvidenceAnchorLine("Bearish", alignment)).toMatch(
      /Bias is bearish, but only 1\/6 layers support downside — not enough for a valid setup/i
    );
  });
});

describe("pickPrimaryLayerDrivers", () => {
  test("returns top two layers matching bearish bias when aligned", () => {
    const layers = [
      layer("technical", "Technical", "Bearish", 90),
      layer("internals", "Market Internals", "Bearish", 75),
      layer("news", "News", "Neutral", 40)
    ];
    expect(pickPrimaryLayerDrivers(layers, "Bearish")).toEqual(["Technical", "Market Internals"]);
  });
});

describe("formatDriversStrip", () => {
  test("renders aligned leading missing", () => {
    expect(
      formatDriversStrip({
        aligned: 0,
        total: 6,
        leading: ["Technical"],
        missing: ["News", "Macro"]
      })
    ).toBe("Aligned 0/6 · Leading Technical · Missing News, Macro");
  });
});
