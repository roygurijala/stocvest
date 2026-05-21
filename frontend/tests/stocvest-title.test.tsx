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
  test("renders Stocvest wordmark", () => {
    render(<StocvestTitle />);
    expect(screen.getByTestId("stocvest-title")).toHaveTextContent("Stocvest");
  });

  test("links home when href provided", () => {
    render(<StocvestTitle href="/dashboard" />);
    expect(screen.getByRole("link", { name: /Stocvest home/i })).toHaveAttribute("href", "/dashboard");
  });
});
