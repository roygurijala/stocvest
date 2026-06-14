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

  test("signalsWithSymbolHref opens trading room deep-dive", () => {
    expect(signalsWithSymbolHref("aapl", "swing")).toBe(
      "/dashboard?symbol=AAPL&lane=swing&ref=setup-evolution"
    );
    expect(signalsWithSymbolHref("aapl", "swing", "setup-outcomes")).toContain("ref=setup-outcomes");
  });

  test("signalsOpenEvidenceHref and layers anchor use trading room", () => {
    expect(signalsOpenEvidenceHref("tsla", "day")).toContain("symbol=TSLA");
    expect(signalsOpenEvidenceHref("tsla", "day")).toContain("lane=day");
    expect(signalsLayersSectionHref("tsla", "day")).toBe(
      "/dashboard?symbol=TSLA&lane=day&ref=setup-evolution"
    );
  });
});
