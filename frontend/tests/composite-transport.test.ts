import { describe, expect, test } from "vitest";

import {
  compositeFetchErrorMessage,
  getCompositeTransportError
} from "@/lib/api/composite-transport";

describe("composite-transport", () => {
  test("parses timeout envelope", () => {
    const err = getCompositeTransportError({
      error: "timeout",
      message: "Signal analysis timed out. Try again in a moment."
    });
    expect(err?.code).toBe("timeout");
    expect(err?.message).toContain("timed out");
  });

  test("returns null for layer payloads", () => {
    expect(getCompositeTransportError({ symbol: "AAPL", layers: [] })).toBeNull();
  });

  test("maps fetch 503 to user message", () => {
    expect(
      compositeFetchErrorMessage(new Error("Composite request failed: 503 Service Unavailable"))
    ).toContain("temporarily unavailable");
  });
});
