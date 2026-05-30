import { describe, expect, test } from "vitest";

import {
  alignedLayerNames,
  formatMaturationLayerKey,
  maturationAlignmentCounts,
  missingLayerNames
} from "@/lib/watchlist-alignment-present";

describe("watchlist-alignment-present", () => {
  test("formats layer keys for display", () => {
    expect(formatMaturationLayerKey("internals")).toBe("Market Internals");
    expect(formatMaturationLayerKey("macro")).toBe("Macro");
  });

  test("derives aligned and missing from missing_layers", () => {
    const row = {
      state: "developing",
      layers_aligned: 3,
      layers_total: 6,
      missing_layers: ["macro", "news", "geopolitical"]
    };
    expect(maturationAlignmentCounts(row)).toEqual({ aligned: 3, total: 6 });
    expect(alignedLayerNames(row)).toEqual(["Technical", "Sector", "Market Internals"]);
    expect(missingLayerNames(row)).toEqual(["Macro", "News", "Geopolitical"]);
  });
});
