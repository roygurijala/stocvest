import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { BuildScenarioButton } from "@/components/scenario-builder/build-scenario-button";
import { ThemeProvider } from "@/lib/theme-provider";
import type { ScenarioInput } from "@/lib/scenario/types";

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
    reference: { current_price: 100, stop: 95 },
    volatility_regime: "normal"
  };
}

describe("BuildScenarioButton — eligible state", () => {
  test("test_renders_enabled_with_build_scenario_label", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} />);
    const btn = screen.getByTestId("build-scenario-button");
    expect(btn).toBeInTheDocument();
    expect(btn).not.toHaveAttribute("disabled");
    expect(btn.getAttribute("data-eligible")).toBe("true");
    expect(btn.textContent).toContain("Build scenario");
  });

  test("test_eligible_tooltip_is_ready_copy", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} />);
    const btn = screen.getByTestId("build-scenario-button");
    const title = btn.getAttribute("title") ?? "";
    expect(title).toContain("Ready to build scenario");
  });
});

describe("BuildScenarioButton — ineligible states", () => {
  test("test_disabled_when_no_symbol", () => {
    wrap(
      <BuildScenarioButton
        input={{ ...eligibleInput(), symbol: "" }}
      />
    );
    const btn = screen.getByTestId("build-scenario-button");
    expect(btn).toHaveAttribute("disabled");
    expect(btn.getAttribute("data-eligible")).toBe("false");
    expect(btn.textContent).toContain("Scenario unavailable");
  });

  test("test_disabled_when_volatility_unknown_and_no_anchor", () => {
    wrap(
      <BuildScenarioButton
        input={{
          ...eligibleInput(),
          reference: { current_price: 100 },
          volatility_regime: "unknown"
        }}
      />
    );
    const btn = screen.getByTestId("build-scenario-button");
    expect(btn).toHaveAttribute("disabled");
    const title = btn.getAttribute("title") ?? "";
    expect(title).toContain("Volatility regime is unknown");
    expect(title).toContain("No way to express risk numerically");
  });

  test("test_disabled_label_never_uses_endorsement_words", () => {
    wrap(
      <BuildScenarioButton
        input={{ ...eligibleInput(), symbol: "" }}
      />
    );
    const btn = screen.getByTestId("build-scenario-button");
    const title = (btn.getAttribute("title") ?? "").toLowerCase();
    const content = (btn.textContent ?? "").toLowerCase();
    for (const banned of ["recommend", "approve", "validated", "qualified", "cleared", "endorsed"]) {
      expect(title).not.toContain(banned);
      expect(content).not.toContain(banned);
    }
  });

  test("test_disabled_when_gap_intel_gate_blocks", () => {
    wrap(
      <BuildScenarioButton
        input={{
          ...eligibleInput(),
          gap_intel_gate: { scenario_builder_state: "DISABLED", reasons: ["market_closed"] }
        }}
      />
    );
    const btn = screen.getByTestId("build-scenario-button");
    expect(btn).toHaveAttribute("disabled");
    const title = btn.getAttribute("title") ?? "";
    expect(title).toContain("Gap Intelligence");
  });
});

describe("BuildScenarioButton — never implies execution", () => {
  test("test_label_never_says_place_order_or_draft_trade", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} />);
    const btn = screen.getByTestId("build-scenario-button");
    const content = (btn.textContent ?? "").toLowerCase();
    expect(content).not.toContain("place order");
    expect(content).not.toContain("submit");
    expect(content).not.toContain("draft trade");
    expect(content).not.toContain("buy now");
    expect(content).not.toContain("sell now");
  });
});

describe("BuildScenarioButton — prominent variant", () => {
  test("test_prominent_sets_data_variant", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} variant="prominent" />);
    const btn = screen.getByTestId("build-scenario-button");
    expect(btn.getAttribute("data-variant")).toBe("prominent");
  });
});

describe("BuildScenarioButton — testId override", () => {
  test("test_custom_testId_applied", () => {
    wrap(<BuildScenarioButton input={eligibleInput()} testId="build-scenario-custom" />);
    expect(screen.getByTestId("build-scenario-custom")).toBeInTheDocument();
  });
});
