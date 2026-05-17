import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { BuildScenarioButton } from "@/components/scenario-builder/build-scenario-button";
import { ThemeProvider } from "@/lib/theme-provider";
import type { ScenarioInput } from "@/lib/scenario/types";
import type { ScenarioReadinessContext } from "@/lib/scenario/scenario-readiness";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  });
});

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function eligibleInput(): ScenarioInput {
  return {
    symbol: "AAPL",
    direction: "bullish",
    mode: "day",
    generated_at: new Date().toISOString(),
    reference: { current_price: 100, stop: 95, target_1: 110 },
    volatility_regime: "normal"
  };
}

function actionableReadiness(): ScenarioReadinessContext {
  return {
    symbol: "AAPL",
    mode: "day",
    setupBias: "Bullish",
    decisionState: "actionable",
    layersAligned: 6,
    layersTotal: 6,
    hasReferenceLevels: true
  };
}

describe("BuildScenarioButton — always enabled", () => {
  test("renders Scenario Builder label and is never disabled", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} />);
    const btn = screen.getByTestId("build-scenario-button");
    expect(btn).toBeInTheDocument();
    expect(btn).not.toHaveAttribute("disabled");
    expect(btn.textContent).toContain("Scenario Builder");
  });

  test("full capability when actionable and structurally eligible", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} readiness={actionableReadiness()} />);
    const btn = screen.getByTestId("build-scenario-button");
    expect(btn.getAttribute("data-capability")).toBe("full");
    expect(btn.getAttribute("data-eligible")).toBe("true");
    const title = btn.getAttribute("title") ?? "";
    expect(title).toContain("full scenario planning");
  });

  test("preview capability without actionable readiness", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} />);
    const btn = screen.getByTestId("build-scenario-button");
    expect(btn.getAttribute("data-capability")).toBe("preview");
    expect(btn.getAttribute("data-eligible")).toBe("false");
  });

  test("building_soon capability at 3/6 alignment", () => {
    wrap(
      <BuildScenarioButton
        input={eligibleInput()}
        readiness={{
          symbol: "AAPL",
          mode: "day",
          setupBias: "Bullish",
          layersAligned: 3,
          layersTotal: 6
        }}
      />
    );
    expect(screen.getByTestId("build-scenario-button").getAttribute("data-capability")).toBe("building_soon");
  });
});

describe("BuildScenarioButton — gated output not access", () => {
  test("empty symbol still renders enabled button", () => {
    wrap(<BuildScenarioButton input={{ ...eligibleInput(), symbol: "" }} />);
    const btn = screen.getByTestId("build-scenario-button");
    expect(btn).not.toHaveAttribute("disabled");
    expect(btn.textContent).toContain("Scenario Builder");
  });

  test("gap intel disabled stays enabled with building_soon when setup actionable", () => {
    wrap(
      <BuildScenarioButton
        input={{
          ...eligibleInput(),
          gap_intel_gate: { scenario_builder_state: "DISABLED", reasons: ["market_closed"] }
        }}
        readiness={actionableReadiness()}
      />
    );
    const btn = screen.getByTestId("build-scenario-button");
    expect(btn).not.toHaveAttribute("disabled");
    expect(btn.getAttribute("data-capability")).toBe("building_soon");
  });

  test("click opens preview modal without trade prices when not full", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} />);
    fireEvent.click(screen.getByTestId("build-scenario-button"));
    expect(screen.getByTestId("scenario-builder-preview-modal")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-preview-dual-status")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-preview-setup-chip")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-preview-execution-chip")).toBeInTheDocument();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Entry:\s*\$/i);
    expect(body).not.toMatch(/Stop:\s*\$/i);
    expect(body).not.toMatch(/Risk\/Reward:/i);
  });
});

describe("BuildScenarioButton — never implies execution", () => {
  test("label never says place order or draft trade", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} readiness={actionableReadiness()} />);
    const btn = screen.getByTestId("build-scenario-button");
    const content = (btn.textContent ?? "").toLowerCase();
    expect(content).not.toContain("place order");
    expect(content).not.toContain("submit");
    expect(content).not.toContain("draft trade");
    expect(content).not.toContain("buy now");
    expect(content).not.toContain("sell now");
  });

  test("tooltip never uses endorsement words", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} />);
    const title = (screen.getByTestId("build-scenario-button").getAttribute("title") ?? "").toLowerCase();
    for (const banned of ["recommend", "approve", "validated", "qualified", "cleared", "endorsed"]) {
      expect(title).not.toContain(banned);
    }
  });
});

describe("BuildScenarioButton — prominent variant", () => {
  test("prominent sets data_variant", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} variant="prominent" />);
    expect(screen.getByTestId("build-scenario-button").getAttribute("data-variant")).toBe("prominent");
  });
});

describe("BuildScenarioButton — testId override", () => {
  test("custom testId applied", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} testId="build-scenario-custom" />);
    expect(screen.getByTestId("build-scenario-custom")).toBeInTheDocument();
  });
});
