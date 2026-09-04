import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeepDiveEvidenceTabs } from "@/components/dashboard/trading-room/deep-dive-evidence-tabs";
import { colorTokens } from "@/lib/design-system";

describe("DeepDiveEvidenceTabs", () => {
  it("defaults to Setup selected and switches tabs", () => {
    const onChange = vi.fn();
    render(<DeepDiveEvidenceTabs active="setup" onChange={onChange} colors={colorTokens.dark} />);

    expect(screen.getByTestId("deep-dive-evidence-tab-setup")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("deep-dive-evidence-tab-layers")).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByTestId("deep-dive-evidence-tab-chart"));
    expect(onChange).toHaveBeenCalledWith("chart");
  });
});
