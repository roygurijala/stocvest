import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StocvestTitle } from "@/components/brand/stocvest-title";

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

vi.mock("@/lib/theme-provider", () => ({
  useTheme: () => ({
    colors: {
      text: "#f8fafc",
      textMuted: "#94a3b8",
      accent: "#3b82f6"
    },
    theme: "dark"
  })
}));

describe("StocvestTitle", () => {
  test("renders Stocvest in accent color", () => {
    render(<StocvestTitle />);
    const el = screen.getByTestId("stocvest-title");
    expect(el).toHaveTextContent("Stocvest");
    expect(el).toHaveStyle({ color: "rgb(59, 130, 246)" });
  });
});
