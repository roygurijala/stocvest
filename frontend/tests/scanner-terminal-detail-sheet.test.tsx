import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ScannerTerminalDetailSheet } from "@/components/scanner/terminal/scanner-terminal-detail-sheet";
import { colorTokens } from "@/lib/design-system";

const colors = colorTokens.dark;

function renderSheet(ui: ReactElement) {
  return render(ui);
}

describe("<ScannerTerminalDetailSheet />", () => {
  test("renders when open with title and closes on Escape", () => {
    const onClose = vi.fn();
    renderSheet(
      <ScannerTerminalDetailSheet open onClose={onClose} title="NVDA" colors={colors}>
        <p>Detail body</p>
      </ScannerTerminalDetailSheet>
    );

    expect(screen.getByTestId("scanner-terminal-detail-sheet")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getByText("Detail body")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("does not render when closed", () => {
    renderSheet(
      <ScannerTerminalDetailSheet open={false} onClose={() => {}} colors={colors}>
        <p>Hidden</p>
      </ScannerTerminalDetailSheet>
    );

    expect(screen.queryByTestId("scanner-terminal-detail-sheet")).toBeNull();
  });
});
