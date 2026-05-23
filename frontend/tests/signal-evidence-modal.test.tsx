import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { ThemeProvider } from "@/lib/theme-provider";
import { resetBodyScrollLock } from "@/lib/body-scroll-lock";

afterEach(() => {
  resetBodyScrollLock();
  vi.restoreAllMocks();
});

describe("SignalEvidenceModal overlay", () => {
  test("locks background scroll while open", () => {
    render(
      <ThemeProvider>
        <SignalEvidenceModal open evidence={null} loading onClose={() => undefined} />
      </ThemeProvider>
    );
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(screen.getByTestId("signal-evidence-modal-overlay")).toHaveClass("app-modal-backdrop-blur");
  });

  test("releases scroll lock when closed", () => {
    const { rerender } = render(
      <ThemeProvider>
        <SignalEvidenceModal open evidence={null} loading onClose={() => undefined} />
      </ThemeProvider>
    );
    rerender(
      <ThemeProvider>
        <SignalEvidenceModal open={false} evidence={null} loading onClose={() => undefined} />
      </ThemeProvider>
    );
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("");
  });
});
