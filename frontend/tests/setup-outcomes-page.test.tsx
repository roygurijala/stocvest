import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { SetupOutcomesPageClient } from "@/components/setup-outcomes-page-client";
import { ThemeProvider } from "@/lib/theme-provider";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("trading_mode=swing")
}));

vi.mock("@/lib/assistant/context", () => ({
  usePublishAssistantContext: vi.fn()
}));

vi.mock("@/lib/api/setup-outcomes", () => ({
  fetchSetupOutcomes: vi.fn(async () => ({
    mode: "swing",
    days: 30,
    has_full_access: false,
    watchlist_symbol_count: 2,
    stats: {
      total_events: 0,
      building_dataset: true,
      by_kind: {},
      alignment_held_rate: null,
      symbols_with_events: 0
    },
    events: [],
    disclaimer: "Observational only."
  }))
}));

describe("SetupOutcomesPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("links to Product KPI on /performance", async () => {
    render(
      <ThemeProvider>
        <SetupOutcomesPageClient />
      </ThemeProvider>
    );
    await screen.findByTestId("setup-outcomes-product-kpi-callout");
    const links = screen.getAllByRole("link", { name: /Product signal accuracy|Signal tracking/i });
    expect(links.some((a) => a.getAttribute("href") === "/performance")).toBe(true);
  });

  test("renders building dataset state", async () => {
    render(
      <ThemeProvider>
        <SetupOutcomesPageClient />
      </ThemeProvider>
    );
    expect(await screen.findByTestId("setup-outcomes-page")).toBeTruthy();
    expect(await screen.findByTestId("setup-outcomes-building")).toBeTruthy();
    expect(screen.getByText(/Setup outcomes/i)).toBeTruthy();
  });

  test("admins see link to D2 stratified validation", async () => {
    render(
      <ThemeProvider>
        <SetupOutcomesPageClient isAdmin />
      </ThemeProvider>
    );
    expect(await screen.findByTestId("setup-outcomes-admin-d2-link")).toBeTruthy();
    expect(screen.getByTestId("setup-outcomes-admin-d2-link").getAttribute("href")).toBe(
      "/dashboard/admin/historical-validation"
    );
  });
});
