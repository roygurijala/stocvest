import { describe, expect, test } from "vitest";

import {
  setupEvolutionHubHref,
  setupOutcomesHref,
  signalsLayersSectionHref,
  signalsOpenEvidenceHref,
  signalsWithSymbolHref
} from "@/lib/nav/setup-analytics-deeplink";

describe("setup-analytics-deeplink", () => {
  test("setupEvolutionHubHref encodes symbol and mode", () => {
    expect(setupEvolutionHubHref("tsla", "day")).toBe(
      "/dashboard/setup-evolution?symbol=TSLA&trading_mode=day"
    );
  });

  test("setupOutcomesHref is mode-isolated", () => {
    expect(setupOutcomesHref("swing")).toContain("trading_mode=swing");
  });

  test("signalsWithSymbolHref", () => {
    expect(signalsWithSymbolHref("aapl", "swing")).toBe(
      "/dashboard/signals?symbol=AAPL&trading_mode=swing&ref=setup-evolution"
    );
    expect(signalsWithSymbolHref("aapl", "swing", "setup-outcomes")).toContain("ref=setup-outcomes");
  });

  test("signalsOpenEvidenceHref and layers anchor", () => {
    expect(signalsOpenEvidenceHref("tsla", "day")).toContain("open_evidence=1");
    expect(signalsOpenEvidenceHref("tsla", "day")).toContain("ref=setup-evolution");
    expect(signalsLayersSectionHref("tsla", "day")).toBe(
      "/dashboard/signals?symbol=TSLA&trading_mode=day&ref=setup-evolution#signals-layers"
    );
  });
});
