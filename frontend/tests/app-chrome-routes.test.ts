import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/nav-features", () => ({
  scannerTerminalEnabled: () => true
}));

import { usesTradingSessionChrome } from "@/lib/app-chrome-routes";

describe("usesTradingSessionChrome", () => {
  test("matches trading room and scanner terminal routes", () => {
    expect(usesTradingSessionChrome("/dashboard")).toBe(true);
    expect(usesTradingSessionChrome("/dashboard/preview")).toBe(true);
    expect(usesTradingSessionChrome("/dashboard/scanner")).toBe(true);
    expect(usesTradingSessionChrome("/dashboard/scanner/preview")).toBe(true);
    expect(usesTradingSessionChrome("/dashboard/watchlists")).toBe(false);
    expect(usesTradingSessionChrome("/dashboard/signals")).toBe(false);
  });
});
