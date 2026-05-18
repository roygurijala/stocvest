import { describe, expect, test } from "vitest";

import {
  setupEvolutionHubHref,
  setupOutcomesHref,
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
      "/dashboard/signals?symbol=AAPL&trading_mode=swing"
    );
  });
});
