import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiSetupRead, type AiSetupReadPalette } from "@/components/signals/ai-setup-read";

const palette: AiSetupReadPalette = {
  text: "#fff",
  textMuted: "#999",
  border: "#333",
  accent: "#2e8bff",
  surface: "#1c2029"
};

function renderRead() {
  return render(
    <AiSetupRead
      symbol="NVDA"
      direction="long"
      desk="swing"
      layers={[{ layer: "technical", status: "Bullish" }]}
      confirming={["Breakout over prior high"]}
      conflicting={["VIX elevated"]}
      catalysts={["Earnings beat"]}
      marketRegime="risk-on"
      fallbackText="NVDA leans long — deterministic brief."
      palette={palette}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AiSetupRead", () => {
  it("fetches and renders an AI-written read on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        text: "NVDA's technical layer is doing the heavy lifting. Signal data only.",
        source: "ai",
        upgrade_available: false,
        cached: false
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRead();
    fireEvent.click(screen.getByText("✦ AI read"));

    await waitFor(() => expect(screen.getByText(/heavy lifting/)).toBeInTheDocument());
    expect(screen.getByText("AI read")).toBeInTheDocument();

    // Verify the posted payload uses the setup_read contract.
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.type).toBe("setup_read");
    expect(body.symbol).toBe("NVDA");
    expect(body.confirming).toContain("Breakout over prior high");
  });

  it("falls back to deterministic brief and shows upgrade nudge for free users", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        text: "NVDA leans long — deterministic brief.",
        source: "deterministic",
        upgrade_available: true,
        cached: false
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    renderRead();
    fireEvent.click(screen.getByText("✦ AI read"));

    await waitFor(() => expect(screen.getByText(/deterministic brief/)).toBeInTheDocument());
    expect(screen.getByText(/Unlock AI-written reads/)).toBeInTheDocument();
  });

  it("keeps the deterministic fallback when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    renderRead();
    fireEvent.click(screen.getByText("✦ AI read"));

    await waitFor(() =>
      expect(screen.getByText("NVDA leans long — deterministic brief.")).toBeInTheDocument()
    );
    expect(screen.getByText("Standard read")).toBeInTheDocument();
  });
});
