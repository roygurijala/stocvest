import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StocvestLogo } from "@/components/brand/stocvest-logo";

vi.mock("next/image", () => ({
  default: ({
    alt,
    priority: _priority,
    ...rest
  }: {
    alt: string;
    priority?: boolean;
    [key: string]: unknown;
  }) => <img alt={alt} data-testid="stocvest-logo-img" {...rest} />
}));

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
  test("renders compact brand image", () => {
    render(<StocvestLogo variant="compact" />);
    expect(screen.getByTestId("stocvest-logo")).toBeInTheDocument();
    expect(screen.getByAltText("STOCVEST")).toBeInTheDocument();
  });

  test("renders full brand asset", () => {
    render(<StocvestLogo variant="full" showTagline />);
    expect(screen.getByAltText("STOCVEST")).toBeInTheDocument();
  });

  test("links home when href provided", () => {
    render(<StocvestLogo variant="compact" href="/dashboard" />);
    expect(screen.getByRole("link", { name: /STOCVEST home/i })).toHaveAttribute("href", "/dashboard");
  });
});
