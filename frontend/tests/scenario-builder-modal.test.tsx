import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";

import { ScenarioBuilderModal } from "@/components/scenario-builder/scenario-builder-modal";
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

const baseInput: ScenarioInput = {
  symbol: "AAPL",
  direction: "bullish",
  mode: "swing",
  generated_at: new Date().toISOString(),
  reference: {
    entry_low: 195,
    entry_high: 197,
    stop: 192,
    target_1: 202,
    target_2: 208,
    current_price: 196,
    atr: 2.5
  },
  volatility_regime: "normal"
};

describe("ScenarioBuilderModal — structural blocks present", () => {
  test("test_renders_reference_user_input_computed_blocks", () => {
    wrap(<ScenarioBuilderModal open input={baseInput} onClose={vi.fn()} />);
    expect(screen.getByTestId("scenario-reference-block")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-userinput-block")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-computed-block")).toBeInTheDocument();
  });

  test("test_disclaimer_block_present_with_safe_language", () => {
    wrap(<ScenarioBuilderModal open input={baseInput} onClose={vi.fn()} />);
    const disclaimer = screen.getByTestId("scenario-disclaimer");
    expect(disclaimer).toBeInTheDocument();
    const text = (disclaimer.textContent ?? "").toLowerCase();
    expect(text).toContain("planning scenario");
    expect(text).toContain("does not submit");
    expect(text).toContain("not entry, stop, or exit endorsements");
  });

  test("test_reference_rows_carry_reference_tag", () => {
    wrap(<ScenarioBuilderModal open input={baseInput} onClose={vi.fn()} />);
    const refSymbol = screen.getByTestId("scenario-ref-symbol");
    expect(refSymbol.textContent).toContain("AAPL");
    expect(refSymbol.textContent).toContain("Reference");
  });
});

describe("ScenarioBuilderModal — terminal actions are NOT submit", () => {
  test("test_no_submit_button_exists", () => {
    wrap(<ScenarioBuilderModal open input={baseInput} onClose={vi.fn()} />);
    // The footer must not contain a "Submit" / "Place order" / "Send
    // to broker" affordance. Every terminal action is planning-only.
    const modal = screen.getByTestId("scenario-builder-modal");
    const text = (modal.textContent ?? "").toLowerCase();
    expect(text).not.toContain("place order");
    expect(text).not.toContain("submit order");
    expect(text).not.toContain("send to broker");
    expect(text).not.toContain("buy now");
    expect(text).not.toContain("sell now");
  });

  test("test_copy_close_reset_buttons_exist", () => {
    wrap(<ScenarioBuilderModal open input={baseInput} onClose={vi.fn()} />);
    expect(screen.getByTestId("scenario-copy")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-reset")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-close-footer")).toBeInTheDocument();
  });

  test("test_modal_never_uses_recommendation_or_approval_words", () => {
    wrap(<ScenarioBuilderModal open input={baseInput} onClose={vi.fn()} />);
    const modal = screen.getByTestId("scenario-builder-modal");
    const text = (modal.textContent ?? "").toLowerCase();
    for (const banned of ["recommended", "approved", "validated", "qualified", "cleared", "endorsed"]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe("ScenarioBuilderModal — close action wires through", () => {
  test("test_clicking_close_calls_onClose", () => {
    const onClose = vi.fn();
    wrap(<ScenarioBuilderModal open input={baseInput} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("scenario-builder-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("test_clicking_footer_close_calls_onClose", () => {
    const onClose = vi.fn();
    wrap(<ScenarioBuilderModal open input={baseInput} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("scenario-close-footer"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ScenarioBuilderModal — reset button restores defaults", () => {
  test("test_reset_button_clickable_does_not_crash", () => {
    wrap(<ScenarioBuilderModal open input={baseInput} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("scenario-input-shares"), { target: { value: "999" } });
    fireEvent.click(screen.getByTestId("scenario-reset"));
    // After reset, shares input should be back to the default (100).
    const sharesInput = screen.getByTestId("scenario-input-shares") as HTMLInputElement;
    expect(sharesInput.value).toBe("100");
  });
});

describe("ScenarioBuilderModal — closed mode does not render", () => {
  test("test_closed_mode_renders_nothing", () => {
    wrap(<ScenarioBuilderModal open={false} input={baseInput} onClose={vi.fn()} />);
    expect(screen.queryByTestId("scenario-builder-modal")).not.toBeInTheDocument();
  });
});
