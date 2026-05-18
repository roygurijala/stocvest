import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DashboardDailyPulse } from "@/components/dashboard/dashboard-daily-pulse";
import { ThemeProvider } from "@/lib/theme-provider";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    })
  });
});

describe("DashboardDailyPulse", () => {
  it("renders swing near-ready copy from maturation-summary", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("mode=swing")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            by_symbol: {
              AMD: { state: "developing", layers_aligned: 4, layers_total: 6, label: "Developing" }
            }
          })
        });
      }
      if (url.includes("mode=day")) {
        return Promise.resolve({ ok: true, json: async () => ({ by_symbol: {} }) });
      }
      return Promise.reject(new Error(url));
    });
    global.fetch = fetchMock as typeof fetch;

    render(
      <ThemeProvider>
        <DashboardDailyPulse dayTradingSurfaces />
      </ThemeProvider>
    );

    await waitFor(() => expect(screen.getByTestId("dashboard-daily-pulse")).toBeInTheDocument());
    expect(screen.getByTestId("dashboard-daily-pulse-swing")).toHaveTextContent(/near ready on Swing/i);
    expect(screen.getByTestId("dashboard-daily-pulse-closest-swing")).toHaveTextContent(/AMD/);
  });
});
