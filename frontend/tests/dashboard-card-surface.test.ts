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

  test("bullish tone uses neutral surface with green left and bottom accents", () => {
    const chrome = dashboardDirectionCardChrome("bullish", theme);
    expect(chrome.background).toBe(theme.surface);
    expect(chrome.border).toBe(theme.border);
    expect(chrome.borderLeft).toBe(theme.bullish);
    expect(chrome.borderBottom).toBe(theme.bullish);
    expect(chrome.accent).toBe(theme.bullish);
  });

  test("bearish tone uses neutral surface with red left and bottom accents", () => {
    const chrome = dashboardDirectionCardChrome("bearish", theme);
    expect(chrome.background).toBe(theme.surface);
    expect(chrome.borderLeft).toBe(theme.bearish);
    expect(chrome.borderBottom).toBe(theme.bearish);
    expect(chrome.accent).toBe(theme.bearish);
  });

  test("muted tone uses neutral accents on left and bottom", () => {
    const chrome = dashboardDirectionCardChrome("muted", theme);
    expect(chrome.background).toBe(theme.surface);
    expect(chrome.borderLeft).toBe(theme.textMuted);
    expect(chrome.borderBottom).toBe(theme.textMuted);
  });
});

describe("desk-refresh-present", () => {
  test("humanizes service unavailable refresh errors", () => {
    expect(formatDeskRefreshErrorMessage(new Error("Service Unavailable"))).toContain("timed out");
    expect(formatDeskRefreshErrorMessage(new Error("Service Unavailable"))).toContain("cached movers");
  });
});
