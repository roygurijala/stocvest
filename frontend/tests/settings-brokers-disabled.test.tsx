/**
 * Lock-in: the "Connected Brokers" card on the Settings page is hidden
 * while broker integration is paused (BACKLOG B31).
 *
 * Failing this test means a future refactor either dropped the
 * `brokersEnabled()` ternary in `settings-page-client.tsx` or renamed
 * the flag — both regressions that would silently re-expose the
 * E*TRADE / IBKR / MOCK rows.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/settings"
}));

vi.mock("@/lib/assistant/context", () => ({
  usePublishAssistantContext: () => undefined
}));

vi.mock("@/lib/nav-features", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nav-features")>(
    "@/lib/nav-features"
  );
  return {
    ...actual,
    brokersEnabled: () => false
  };
});

const fetchMock = vi.fn().mockResolvedValue(
  new Response(JSON.stringify({}), {
    status: 200,
    headers: { "content-type": "application/json" }
  })
);
global.fetch = fetchMock as unknown as typeof global.fetch;

import { SettingsPageClient } from "@/components/settings-page-client";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("SettingsPageClient (brokers disabled)", () => {
  test("Connected Brokers card is absent", () => {
    wrap(<SettingsPageClient email="u@example.com" />);
    expect(
      screen.queryByTestId("settings-connected-brokers-card")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Connected Brokers")).not.toBeInTheDocument();
    expect(screen.queryByText(/Connect E\*TRADE/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Connect IB Gateway/i)).not.toBeInTheDocument();
  });

  test("the literal 'MOCK / Connected' row is absent (anti-leak)", () => {
    wrap(<SettingsPageClient email="u@example.com" />);
    // The text 'MOCK' inside Connected Brokers card was a leftover from
    // early scaffolding and should never reach users.
    expect(screen.queryByText("MOCK")).not.toBeInTheDocument();
  });
});
