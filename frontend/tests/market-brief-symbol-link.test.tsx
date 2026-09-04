import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MarketBriefSymbolLink } from "@/components/dashboard/trading-room/market-brief-symbol-link";

vi.mock("next/link", () => ({
  default: ({
    href,
    onClick,
    children,
    ...rest
  }: {
    href: string;
    onClick?: (e: { preventDefault: () => void }) => void;
    children: React.ReactNode;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  )
}));

describe("MarketBriefSymbolLink", () => {
  it("calls onSelect and prevents navigation", () => {
    const onSelect = vi.fn();
    render(
      <MarketBriefSymbolLink symbol="aapl" lane="swing" onSelect={onSelect} data-testid="link-aapl">
        AAPL
      </MarketBriefSymbolLink>
    );
    fireEvent.click(screen.getByTestId("link-aapl"));
    expect(onSelect).toHaveBeenCalledWith("AAPL", undefined, "swing");
  });
});
