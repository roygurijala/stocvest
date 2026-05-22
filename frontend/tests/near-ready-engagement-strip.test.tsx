import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NearReadyEngagementStrip } from "@/components/dashboard/near-ready-engagement-strip";
import { ThemeProvider } from "@/lib/theme-provider";

describe("NearReadyEngagementStrip", () => {
  it("renders tracked near-ready symbols for the active desk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("maturation-summary") && url.includes("mode=swing")) {
          return {
            ok: true,
            json: async () => ({
              mode: "swing",
              near_ready_count: 1,
              near_ready_symbols: ["AMD"],
              by_symbol: {
                AMD: {
                  state: "developing",
                  label: "Developing",
                  layers_aligned: 4,
                  progress_band: "near_ready"
                }
              }
            })
          };
        }
        return { ok: false, json: async () => ({}) };
      })
    );

    render(
      <ThemeProvider>
        <NearReadyEngagementStrip mode="swing" />
      </ThemeProvider>
    );

    await waitFor(() => expect(screen.getByTestId("dashboard-near-ready-engagement")).toBeInTheDocument());
    expect(screen.getByText(/1 near-ready on your Swing watchlist/i)).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-near-ready-symbols")).toHaveTextContent("AMD");
    vi.unstubAllGlobals();
  });
});
