import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StocvestLogo, STOCVEST_LOGO_VARIANTS } from "@/components/brand/stocvest-logo";

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    priority: _priority,
    ...rest
  }: {
    alt: string;
    src: string;
    priority?: boolean;
    [key: string]: unknown;
  }) => <img alt={alt} src={src} data-testid="stocvest-logo-img" {...rest} />
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

describe("StocvestLogo", () => {
  test("nav variant uses header_logo_400w", () => {
    render(<StocvestLogo variant="nav" />);
    expect(screen.getByTestId("stocvest-logo")).toHaveAttribute("data-variant", "nav");
    expect(screen.getByAltText("STOCVEST")).toHaveAttribute(
      "src",
      STOCVEST_LOGO_VARIANTS.nav.src
    );
  });

  test("header variant uses header_logo_600w", () => {
    render(<StocvestLogo variant="header" />);
    expect(screen.getByAltText("STOCVEST")).toHaveAttribute(
      "src",
      STOCVEST_LOGO_VARIANTS.header.src
    );
  });

  test("stacked variant uses full_logo_with_tagline_600w", () => {
    render(<StocvestLogo variant="stacked" />);
    expect(screen.getByAltText("STOCVEST")).toHaveAttribute(
      "src",
      STOCVEST_LOGO_VARIANTS.stacked.src
    );
  });

  test("footer variant uses wordmark_only_300w", () => {
    render(<StocvestLogo variant="footer" />);
    expect(screen.getByAltText("STOCVEST")).toHaveAttribute(
      "src",
      STOCVEST_LOGO_VARIANTS.footer.src
    );
  });

  test("links home when href provided", () => {
    render(<StocvestLogo variant="nav" href="/dashboard" />);
    expect(screen.getByRole("link", { name: /STOCVEST home/i })).toHaveAttribute("href", "/dashboard");
  });
});
