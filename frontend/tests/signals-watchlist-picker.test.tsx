import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test } from "vitest";
import {
  SignalsWatchlistPickerModal,
  formatPickerMaturationLabel,
  maturationPickerBadge
} from "@/components/signals/signals-watchlist-picker-modal";
import { ThemeProvider } from "@/lib/theme-provider";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false
    })
  });
});

describe("maturationPickerBadge", () => {
  test("maps developing with alignment and not_aligned", () => {
    expect(
      formatPickerMaturationLabel({ state: "developing", label: "Developing", layers_aligned: 3, layers_total: 6 })
    ).toBe("Developing (3/6)");
    expect(maturationPickerBadge({ state: "not_aligned", label: "Not aligned" }).label).toBe("Not aligned");
  });

  test("missing maturation row is not evaluated yet", () => {
    expect(maturationPickerBadge(undefined).label).toBe("Not evaluated yet");
  });
});

describe("SignalsWatchlistPickerModal", () => {
  test("filters symbols by search and shows maturation badge", () => {
    render(
      <ThemeProvider>
        <SignalsWatchlistPickerModal
          open
          symbols={["AAPL", "TSLA", "NVDA"]}
          maturationBySymbol={{
            AAPL: {
              state: "developing",
              label: "Developing",
              layers_aligned: 4,
              layers_total: 6,
              last_evaluated_at: "2026-05-16T12:00:00+00:00"
            },
            TSLA: { state: "not_aligned", label: "Not aligned", layers_aligned: 0, layers_total: 6 }
          }}
          loading={false}
          tradingMode="swing"
          onSelect={() => undefined}
          onClose={() => undefined}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("signals-watchlist-picker-title")).toHaveTextContent(/Swing evaluation status/i);
    expect(screen.getByTestId("signals-watchlist-picker-evaluation-mode")).toBeInTheDocument();
    expect(screen.getByTestId("signals-watchlist-picker-search")).toBeInTheDocument();
    expect(screen.getByTestId("signals-watchlist-picker-badge-TSLA")).toHaveTextContent(/Not aligned/i);
    expect(screen.getByTestId("signals-watchlist-picker-badge-AAPL")).toHaveTextContent(/Near ready \(4\/6\)/);
    expect(screen.getByTestId("signals-watchlist-picker-hint-NVDA")).toHaveTextContent(/Tap to evaluate/i);
    fireEvent.change(screen.getByTestId("signals-watchlist-picker-search"), { target: { value: "TS" } });
    expect(screen.queryByTestId("signals-watchlist-picker-row-AAPL")).not.toBeInTheDocument();
    expect(screen.getByTestId("signals-watchlist-picker-row-TSLA")).toBeInTheDocument();
  });
});
