/**
 * Settings "Recent Alerts" uses symbol + alert_type from history API when present.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/settings"
}));

vi.mock("@/lib/assistant/context", () => ({
  usePublishAssistantContext: () => undefined
}));

vi.mock("@/lib/nav-features", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nav-features")>("@/lib/nav-features");
  return { ...actual, brokersEnabled: () => false };
});

const defaultPrefs = {
  email_enabled: true,
  on_signal_fired: true,
  on_confluence_alert: true,
  on_pdt_warning: true,
  on_pdt_blocked: true,
  on_gap_detected: false,
  on_watchlist_maturation: true,
  watchlist_only: true,
  quiet_hours_enabled: false,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00"
};

const fetchMock = vi.fn();
global.fetch = fetchMock as unknown as typeof global.fetch;

import { SettingsPageClient } from "@/components/settings-page-client";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("SettingsPageClient — recent alert history", () => {
  test("shows symbol, type label, title, and timestamp", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/alerts/preferences")) {
        return Promise.resolve(
          new Response(JSON.stringify(defaultPrefs), { status: 200, headers: { "content-type": "application/json" } })
        );
      }
      if (url.includes("/alerts/history")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              alerts: [
                {
                  title: "Developing → Actionable",
                  created_at: "2026-05-15T14:00:00+00:00",
                  status: "sent",
                  symbol: "aapl",
                  alert_type: "watchlist_maturation"
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    wrap(<SettingsPageClient email="u@example.com" />);

    await waitFor(() => expect(screen.getByTestId("settings-recent-alerts-list")).toBeInTheDocument());
    const list = screen.getByTestId("settings-recent-alerts-list");
    const symLink = within(list).getByRole("link", { name: /Open AAPL on Signals/i });
    expect(symLink.getAttribute("href")).toContain("/dashboard/signals");
    expect(symLink.getAttribute("href")).toContain("ref=watchlist");
    expect(symLink.getAttribute("href")).toContain("symbol=AAPL");
    expect(list.textContent).toContain("(Maturation)");
    expect(list.textContent).toContain("Developing → Actionable");
    expect(list.textContent).toContain("2026-05-15T14:00");
  });

  test("uses em dash when symbol is missing", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/alerts/preferences")) {
        return Promise.resolve(
          new Response(JSON.stringify(defaultPrefs), { status: 200, headers: { "content-type": "application/json" } })
        );
      }
      if (url.includes("/alerts/history")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              alerts: [
                {
                  title: "Account notice",
                  created_at: "2026-05-10T10:00:00+00:00",
                  status: "sent",
                  symbol: null,
                  alert_type: "pdt_warning"
                }
              ]
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });

    wrap(<SettingsPageClient email="u@example.com" />);

    await waitFor(() => expect(screen.getByTestId("settings-recent-alerts-list")).toBeInTheDocument());
    const list = screen.getByTestId("settings-recent-alerts-list");
    expect(list.querySelector("a")).toBeNull();
    expect(list.textContent).toContain("—");
    expect(list.textContent).toContain("(PDT warning)");
    expect(list.textContent).toContain("Account notice");
  });
});
