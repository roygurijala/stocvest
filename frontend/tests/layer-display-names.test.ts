import { describe, expect, test } from "vitest";

import { signalLayerDisplayName, SIGNAL_LAYER_DISPLAY_NAMES } from "@/lib/signals/layer-display-names";

describe("signalLayerDisplayName", () => {
  test("maps internals key to Market Internals", () => {
    expect(signalLayerDisplayName("internals")).toBe("Market Internals");
    expect(SIGNAL_LAYER_DISPLAY_NAMES.internals).toBe("Market Internals");
  });

  test("passes through unknown keys unchanged", () => {
    expect(signalLayerDisplayName("custom_layer")).toBe("custom_layer");
  });
});
