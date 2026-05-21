import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { SignalsCommandBar } from "@/components/signals/signals-command-bar";
import { ThemeProvider } from "@/lib/theme-provider";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));

describe("SignalsCommandBar", () => {
  test("renders open full evidence in command bar when handler provided", () => {
    const onOpenEvidence = vi.fn();
    render(
      <ThemeProvider>
        <SignalsCommandBar
          symbol="AAPL"
          tradingMode="swing"
          dayTradingSurfaces={false}
          watchlistControl={<span>Watchlist</span>}
          maturationLine={null}
          evaluationFreshness={null}
          onTradingModeChange={vi.fn()}
          onOpenEvidence={onOpenEvidence}
        />
      </ThemeProvider>
    );
    const btn = screen.getByTestId("signals-open-evidence-button");
    expect(btn).toHaveTextContent("Open full evidence");
    expect(screen.queryByTestId("signals-open-evidence-button-mobile")).toBeNull();
    fireEvent.click(btn);
    expect(onOpenEvidence).toHaveBeenCalledTimes(1);
  });
});
