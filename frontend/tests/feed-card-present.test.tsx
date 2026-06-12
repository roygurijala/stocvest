import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CardRefreshButton } from "@/lib/dashboard/trading-room/feed-card-present";
import { colorTokens } from "@/lib/design-system";

describe("CardRefreshButton", () => {
  test("uses accent styling so refresh controls stand out on cards", () => {
    const onRefresh = vi.fn();
    render(
      <CardRefreshButton label="Refresh AAPL swing" busy={false} colors={colorTokens.dark} onRefresh={onRefresh} />
    );
    const btn = screen.getByRole("button", { name: "Refresh AAPL swing" });
    expect(btn).toHaveStyle({ color: colorTokens.dark.accent });
    fireEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
