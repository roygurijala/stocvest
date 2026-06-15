import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { DashboardLayerDots, layerDotsFilled } from "@/components/dashboard/dashboard-layer-dots";

describe("dashboard-layer-dots", () => {
  test("layerDotsFilled builds aligned boolean strip", () => {
    expect(layerDotsFilled(5, 6)).toEqual([true, true, true, true, true, false]);
  });

  test("renders pill segments instead of unicode circles", () => {
    const { container } = render(
      <DashboardLayerDots filled={[true, true, false]} total={3} accent="#22c55e" />
    );
    expect(container.textContent).not.toMatch(/[●○]/);
    expect(container.querySelectorAll('[data-testid="layer-dot-filled"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-testid="layer-dot-empty"]')).toHaveLength(1);
    expect(container.textContent).toContain("(2/3)");
  });
});
