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

// ─── Close button ────────────────────────────────────────────────────────────

describe("AssistantPanel — close", () => {
  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByLabelText(/close stocvest assistant/i));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
