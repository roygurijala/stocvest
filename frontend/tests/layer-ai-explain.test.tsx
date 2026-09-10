import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { LayerAiExplain } from "@/components/signals/layer-ai-explain";

const colors = {
  surface: "#111",
  surfaceMuted: "#1a1a1a",
  border: "#333",
  text: "#eee",
  textMuted: "#999",
  accent: "#3b82f6"
} as unknown as Parameters<typeof LayerAiExplain>[0]["colors"];

function baseProps() {
  return {
    symbol: "AAPL",
    desk: "position" as const,
    bias: "Bullish",
    layerKey: "technical",
    layerName: "Technical",
    verdict: "bullish",
    score: 84,
    rationale: "At 84/100 the layer clears its ≥60 bullish cutoff, so it reads bullish.",
    drivers: ["Price above rising SMA50/200", "RSI 61 not overbought"],
    colors
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LayerAiExplain", () => {
  test("starts idle, then fetches and renders an AI explanation on click", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "Trend is firmly constructive. Signal data only.", source: "ai", cached: false })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LayerAiExplain {...baseProps()} />);
    expect(screen.queryByTestId("layer-ai-explain-text")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("layer-ai-explain-button"));

    await waitFor(() => expect(screen.getByTestId("layer-ai-explain-text")).toBeInTheDocument());
    expect(screen.getByTestId("layer-ai-explain-text")).toHaveTextContent(/firmly constructive/);
    expect(screen.getByTestId("layer-ai-explain-button")).toHaveTextContent(/Regenerate explanation/);

    // Sent the layer_read request with the deterministic fallback + layer packet.
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.type).toBe("layer_read");
    expect(sent.desk).toBe("position");
    expect(sent.layer.key).toBe("technical");
    expect(sent.layer.drivers).toContain("RSI 61 not overbought");
    expect(String(sent.fallback_text)).toContain("Signal data only.");
  });

  test("falls back to deterministic text and shows upgrade nudge when gated", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        text: "At 84/100 the layer clears its ≥60 bullish cutoff, so it reads bullish. Signal data only.",
        source: "deterministic",
        upgrade_available: true
      })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LayerAiExplain {...baseProps()} />);
    fireEvent.click(screen.getByTestId("layer-ai-explain-button"));

    await waitFor(() => expect(screen.getByTestId("layer-ai-explain-text")).toBeInTheDocument());
    expect(screen.getByTestId("layer-ai-explain-text")).toHaveTextContent(/clears its ≥60 bullish cutoff/);
    expect(screen.getByText(/Unlock AI-written explanations/)).toBeInTheDocument();
  });

  test("uses the deterministic fallback when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<LayerAiExplain {...baseProps()} />);
    fireEvent.click(screen.getByTestId("layer-ai-explain-button"));

    await waitFor(() => expect(screen.getByTestId("layer-ai-explain-text")).toBeInTheDocument());
    expect(screen.getByTestId("layer-ai-explain-text")).toHaveTextContent(/Drivers:/);
    expect(screen.getByTestId("layer-ai-explain-text")).toHaveTextContent(/Signal data only\./);
  });
});
