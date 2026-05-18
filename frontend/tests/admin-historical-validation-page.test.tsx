import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AdminHistoricalValidationPageClient } from "@/components/admin-historical-validation-page-client";
import { ThemeProvider } from "@/lib/theme-provider";

vi.mock("@/components/historical-validation-panel", () => ({
  HistoricalValidationPanel: () => <div data-testid="historical-validation-panel-mock" />
}));

vi.mock("@/lib/assistant/context", () => ({
  usePublishAssistantContext: vi.fn()
}));

function renderPage() {
  return render(
    <ThemeProvider>
      <AdminHistoricalValidationPageClient />
    </ThemeProvider>
  );
}

describe("AdminHistoricalValidationPageClient", () => {
  test("renders admin D2 header and embeds HistoricalValidationPanel", () => {
    renderPage();
    expect(screen.getByTestId("admin-historical-validation-page")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Historical validation \(D2\)/i })).toBeTruthy();
    expect(screen.getByTestId("historical-validation-panel-mock")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Setup outcomes/i }).getAttribute("href")).toBe(
      "/dashboard/setup-outcomes"
    );
  });
});
