import { describe, expect, test } from "vitest";
import { dashboardDirectionCardChrome } from "@/lib/dashboard/dashboard-card-surface";
import { formatDeskRefreshErrorMessage } from "@/lib/dashboard/desk-refresh-present";

describe("dashboard-card-surface", () => {
  const theme = {
    surface: "#111827",
    border: "#374151",
    bullish: "#22c55e",
    bearish: "#ef4444",
    textMuted: "#9ca3af"
  };

  test("bullish tone tints card green", () => {
    const chrome = dashboardDirectionCardChrome("bullish", theme);
    expect(chrome.borderLeft).toBe(theme.bullish);
    expect(chrome.background).toContain(theme.bullish);
  });

  test("bearish tone tints card red", () => {
    const chrome = dashboardDirectionCardChrome("bearish", theme);
    expect(chrome.borderLeft).toBe(theme.bearish);
    expect(chrome.background).toContain(theme.bearish);
  });
});

describe("desk-refresh-present", () => {
  test("humanizes service unavailable refresh errors", () => {
    expect(formatDeskRefreshErrorMessage(new Error("Service Unavailable"))).toContain("timed out");
    expect(formatDeskRefreshErrorMessage(new Error("Service Unavailable"))).toContain("cached movers");
  });
});
