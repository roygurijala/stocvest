import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StocvestLogo } from "@/components/brand/stocvest-logo";

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

describe("StocvestLogo", () => {
  test("renders compact wordmark", () => {
    render(<StocvestLogo variant="compact" />);
    expect(screen.getByTestId("stocvest-logo")).toBeInTheDocument();
    expect(screen.getByText("STOCVEST")).toBeInTheDocument();
  });

  test("renders tagline on full variant when enabled", () => {
    render(<StocvestLogo variant="full" showTagline />);
    expect(screen.getByText(/Judgment/i)).toBeInTheDocument();
  });

  test("links home when href provided", () => {
    render(<StocvestLogo variant="compact" href="/dashboard" />);
    expect(screen.getByRole("link", { name: /STOCVEST home/i })).toHaveAttribute("href", "/dashboard");
  });
});
