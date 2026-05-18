import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  )
}));
import { beforeAll, describe, expect, test } from "vitest";
import { WatchlistAlignmentSheet } from "@/components/watchlists/watchlist-alignment-sheet";
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

describe("WatchlistAlignmentSheet", () => {
  test("shows Near ready and threshold hint at 4/6", () => {
    render(
      <ThemeProvider>
        <WatchlistAlignmentSheet
          open
          symbol="AAPL"
          deskMode="swing"
          row={{
            state: "developing",
            layers_aligned: 4,
            layers_total: 6,
            bias: "long",
            missing_layers: ["internals", "options"]
          }}
          onClose={() => undefined}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("watchlist-alignment-sheet")).toHaveTextContent(/Near ready/i);
    expect(screen.getByTestId("watchlist-alignment-sheet")).toHaveTextContent(
      /one layer from actionable threshold/i
    );
    expect(screen.getByTestId("watchlist-alignment-links-evolution")).toHaveAttribute(
      "href",
      expect.stringContaining("/dashboard/setup-evolution")
    );
  });
});
