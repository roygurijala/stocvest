import React from "react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { LegalAcknowledgmentModal } from "@/components/legal-acknowledgment-modal";
import { ThemeProvider } from "@/lib/theme-provider";

describe("LegalAcknowledgmentModal", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("CTA disabled until all checkboxes checked", async () => {
    const onCompleted = vi.fn();
    render(
      <ThemeProvider>
        <LegalAcknowledgmentModal onCompleted={onCompleted} />
      </ThemeProvider>
    );
    const cta = screen.getByRole("button", { name: /I Understand — Continue/i });
    expect(cta).toBeDisabled();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(5);
    for (const cb of boxes) {
      fireEvent.click(cb);
    }
    expect(cta).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(cta);
    });
    expect(onCompleted).toHaveBeenCalled();
  });
});
