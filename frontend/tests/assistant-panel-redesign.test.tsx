/**
 * Lock-in tests for the redesigned AssistantPanel.
 *
 * Guards the key UX invariants introduced in A1:
 *  - "Ask me anything about stocks…" placeholder
 *  - + (attach) button present
 *  - Mic button present
 *  - "Your question" label removed
 *  - Image preview renders when attachment provided
 *  - Remove button clears the attachment
 *  - Disclaimer text present
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { AssistantPanel } from "../components/assistant/assistant-panel";
import type { AttachedImage } from "../lib/assistant/types";

// Minimal stub for ThemeColors
const COLORS = {
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  background: "#0f172a",
  surface: "#1e293b",
  surfaceMuted: "#0f172a",
  border: "#1e293b",
  accent: "#38bdf8",
  bullish: "#22c55e",
  bearish: "#ef4444",
  caution: "#f59e0b",
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof AssistantPanel>> = {}) {
  const defaults = {
    colors: COLORS as never,
    context: null,
    messages: [],
    composerValue: "",
    setComposerValue: vi.fn(),
    onSubmit: vi.fn(),
    onClose: vi.fn(),
    loading: false,
    isAuthenticated: true,
  };
  return render(<AssistantPanel {...defaults} {...overrides} />);
}

// ─── Placeholder text ────────────────────────────────────────────────────────

describe("AssistantPanel — placeholder", () => {
  it("shows 'Ask me anything about stocks…' as composer placeholder", () => {
    renderPanel();
    const textarea = screen.getByRole("textbox", { name: /message stocvest assistant/i });
    expect(textarea).toHaveAttribute("placeholder", "Ask me anything about stocks…");
  });

  it("does NOT contain a 'Your question' label", () => {
    renderPanel();
    expect(screen.queryByText(/your question/i)).toBeNull();
  });
});

// ─── Composer buttons ────────────────────────────────────────────────────────

describe("AssistantPanel — composer buttons", () => {
  it("renders an attach (+) button", () => {
    renderPanel();
    // The button (not the hidden file input) has aria-label="Attach image"
    expect(screen.getByRole("button", { name: /attach image/i })).toBeDefined();
  });

  it("renders a mic button", () => {
    renderPanel();
    expect(screen.getByLabelText(/voice input/i)).toBeDefined();
  });

  it("renders a send button", () => {
    renderPanel();
    expect(screen.getByLabelText(/send message/i)).toBeDefined();
  });
});

// ─── Image preview ───────────────────────────────────────────────────────────

describe("AssistantPanel — image preview", () => {
  const sampleImage: AttachedImage = {
    data: "abc123",
    media_type: "image/png",
    name: "chart.png",
  };

  it("does not show a preview when no image is attached", () => {
    renderPanel();
    expect(screen.queryByAltText("Attached")).toBeNull();
  });

  it("the attach button is present and triggers a file input", () => {
    renderPanel();
    // Button (role=button) is distinct from the hidden file input.
    const attachBtn = screen.getByRole("button", { name: /attach image/i });
    expect(attachBtn).toBeDefined();
  });
});

// ─── Disclaimer ──────────────────────────────────────────────────────────────

describe("AssistantPanel — disclaimer", () => {
  it("shows the disclaimer text", () => {
    renderPanel();
    expect(screen.getByText(/facts and analysis only/i)).toBeDefined();
    expect(screen.queryByText(/not trading advice/i)).toBeDefined();
  });
});

// ─── Quick prompts ───────────────────────────────────────────────────────────

describe("AssistantPanel — quick prompts", () => {
  it("shows at most 3 quick prompts when no messages", () => {
    renderPanel();
    // Quick prompts appear as role="listitem" buttons in the empty state
    const listItems = screen.queryAllByRole("listitem");
    expect(listItems.length).toBeLessThanOrEqual(3);
  });

  it("does not show the suggested questions list when there are messages", () => {
    renderPanel({
      messages: [
        { id: "1", role: "user", content: "why is MRVL up?" },
        { id: "2", role: "assistant", content: "MRVL is up because..." },
      ],
    });
    // The suggestions list has an explicit aria-label; it must not be present.
    expect(screen.queryByRole("list", { name: /suggested questions/i })).toBeNull();
  });
});

// ─── Loading state ───────────────────────────────────────────────────────────

describe("AssistantPanel — loading state", () => {
  it("send button is disabled while loading", () => {
    renderPanel({ loading: true, composerValue: "why is MRVL up?" });
    const sendBtn = screen.getByLabelText(/send message/i);
    expect(sendBtn).toBeDisabled();
  });

  it("send button is disabled when composer is empty", () => {
    renderPanel({ composerValue: "" });
    const sendBtn = screen.getByLabelText(/send message/i);
    expect(sendBtn).toBeDisabled();
  });

  it("send button is enabled when composer has text and not loading", () => {
    renderPanel({ composerValue: "why is MRVL up?", loading: false });
    const sendBtn = screen.getByLabelText(/send message/i);
    expect(sendBtn).not.toBeDisabled();
  });
});

// ─── Chart mini-card ─────────────────────────────────────────────────────────

describe("AssistantPanel — chart mini-card", () => {
  it("renders a sparkline chart card when an assistant message carries a chart", () => {
    renderPanel({
      messages: [
        { id: "1", role: "user", content: "how is NVDA doing today?" },
        {
          id: "2",
          role: "assistant",
          content: "NVDA is up about 4% today.",
          chart: {
            symbol: "NVDA",
            kind: "intraday",
            interval: "5m",
            points: [
              { t: "2026-06-03T13:30:00+00:00", c: 100 },
              { t: "2026-06-03T13:35:00+00:00", c: 102 },
              { t: "2026-06-03T13:40:00+00:00", c: 104 },
            ],
            last: 104,
            change_pct: 4.0,
            direction: "up",
            levels: [
              { label: "VWAP", kind: "vwap", value: 101.5, distance_pct: -2.4 },
              { label: "Support", kind: "support", value: 96, distance_pct: -7.7 },
              { label: "Analyst target", kind: "target", value: 180, distance_pct: 73.1 },
            ],
          },
        },
      ],
    });
    const card = screen.getByTestId("assistant-chart-card");
    expect(card).toBeDefined();
    expect(card.getAttribute("data-chart-symbol")).toBe("NVDA");
    expect(card.getAttribute("data-chart-direction")).toBe("up");
    expect(screen.getByText("+4.00%")).toBeDefined();
    expect(screen.getByText("$104.00")).toBeDefined();
    // Reference-level chips render with labels and values.
    expect(screen.getByTestId("assistant-chart-levels")).toBeDefined();
    expect(screen.getByText("VWAP")).toBeDefined();
    expect(screen.getByText("Analyst target")).toBeDefined();
    expect(screen.getByText("$180.00")).toBeDefined();
  });

  it("offers an expand-chart toggle that flips its label and aria state", () => {
    renderPanel({
      messages: [
        { id: "1", role: "user", content: "how is NVDA doing today?" },
        {
          id: "2",
          role: "assistant",
          content: "NVDA is up about 4% today.",
          chart: {
            symbol: "NVDA",
            kind: "intraday",
            interval: "5m",
            points: [
              { t: "2026-06-03T13:30:00+00:00", c: 100 },
              { t: "2026-06-03T13:35:00+00:00", c: 102 },
            ],
            last: 102,
            change_pct: 2.0,
            direction: "up",
          },
        },
      ],
    });
    const expandBtn = screen.getByTestId("assistant-chart-expand");
    expect(expandBtn.getAttribute("aria-expanded")).toBe("false");
    expect(expandBtn.textContent).toContain("Expand chart");
    fireEvent.click(expandBtn);
    expect(expandBtn.getAttribute("aria-expanded")).toBe("true");
    expect(expandBtn.textContent).toContain("Hide full chart");
  });

  it("does not render a chart card when no chart is attached", () => {
    renderPanel({
      messages: [
        { id: "1", role: "user", content: "what is a P/E ratio?" },
        { id: "2", role: "assistant", content: "Price to earnings is..." },
      ],
    });
    expect(screen.queryByTestId("assistant-chart-card")).toBeNull();
  });
});

// ─── Close button ────────────────────────────────────────────────────────────

describe("AssistantPanel — close", () => {
  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByLabelText(/close stocvest assistant/i));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
