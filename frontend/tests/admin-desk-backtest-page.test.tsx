import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AdminDeskBacktestPageClient } from "@/components/admin-desk-backtest-page-client";

vi.mock("@/lib/assistant/context", () => ({
  usePublishAssistantContext: vi.fn()
}));

vi.mock("@/components/historical-validation-panel", () => ({
  HistoricalValidationPanel: () => <div data-testid="historical-validation-panel-mock" />
}));

vi.mock("@/components/admin/environment-policy-backtest-panel", () => ({
  EnvironmentPolicyBacktestPanel: () => (
    <div data-testid="environment-policy-backtest-panel-mock" />
  )
}));

vi.mock("@/lib/theme-provider", () => ({
  useTheme: () => ({
    colors: {
      text: "#fff",
      textMuted: "#aaa",
      accent: "#0af",
      border: "#333"
    }
  })
}));

describe("AdminDeskBacktestPageClient", () => {
  it("renders product success and environment replay sections", () => {
    render(<AdminDeskBacktestPageClient />);
    expect(screen.getByTestId("admin-desk-backtest-page")).toBeTruthy();
    expect(screen.getByTestId("historical-validation-panel-mock")).toBeTruthy();
    expect(screen.getByTestId("environment-policy-backtest-panel-mock")).toBeTruthy();
    expect(screen.getByText(/Desk backtesting/i)).toBeTruthy();
  });
});
