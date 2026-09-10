import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DeepDiveLaneToggle } from "@/components/dashboard/trading-room/deep-dive-lane-toggle";

const colors = {
  background: "#0b0f14",
  surface: "#121820",
  surfaceMuted: "#1a2230",
  border: "#2a3544",
  text: "#e8edf4",
  textMuted: "#8b98a8",
  accent: "#3b82f6",
  bullish: "#22c55e",
  bearish: "#ef4444",
  caution: "#f59e0b"
};

describe("DeepDiveLaneToggle (POS-D7)", () => {
  it("renders Day, Swing, and Long Term tabs", () => {
    render(
      <DeepDiveLaneToggle
        activeLane="swing"
        onChange={() => {}}
        dayState={null}
        swingState="actionable"
        symbol="AAPL"
        colors={colors}
      />
    );
    expect(screen.getByRole("tab", { name: /Day/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Swing/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Long Term/i })).toBeTruthy();
  });

  it("calls onChange with position when Long Term tab clicked", () => {
    let lane: string = "swing";
    render(
      <DeepDiveLaneToggle
        activeLane="swing"
        onChange={(l) => {
          lane = l;
        }}
        dayState={null}
        swingState={null}
        symbol="NVDA"
        colors={colors}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /Long Term/i }));
    expect(lane).toBe("position");
  });
});
