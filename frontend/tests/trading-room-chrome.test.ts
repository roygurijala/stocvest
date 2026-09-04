import { describe, expect, test } from "vitest";
import { animationDurations, colorTokens } from "@/lib/design-system";
import {
  tradingRoomFeedCardStyle,
  tradingRoomInsetTileStyle,
  tradingRoomMotionTransition,
  tradingRoomPanelStyle,
  tradingRoomSectionLabelStyle,
  TRADING_ROOM_SECTION_LABEL
} from "@/lib/dashboard/trading-room/trading-room-chrome";

describe("trading-room-chrome (ADR-003 UX-D5)", () => {
  const colors = colorTokens.dark;

  test("section labels use unified micro typography", () => {
    expect(TRADING_ROOM_SECTION_LABEL.letterSpacing).toBe("0.1em");
    expect(tradingRoomSectionLabelStyle(colors).fontWeight).toBe(700);
  });

  test("panel style avoids outer hairline border", () => {
    const panel = tradingRoomPanelStyle(colors);
    expect(panel.border).toBeUndefined();
    expect(panel.background).toBe(colors.surface);
  });

  test("inset tile uses top accent only", () => {
    const tile = tradingRoomInsetTileStyle(colors, "#2e8bff", "dark");
    expect(tile.border).toBe("none");
    expect(tile.borderTop).toContain("#2e8bff");
  });

  test("feed card uses lane rail without bottom accent border", () => {
    const card = tradingRoomFeedCardStyle(colors, { active: true, railAccent: "#6366f1" });
    expect(card.border).toBe("none");
    expect(card.borderLeft).toContain("#6366f1");
    expect(card.borderBottom).toBeUndefined();
  });

  test("motion transition defaults to animationDurations.normal", () => {
    expect(tradingRoomMotionTransition()).toContain(`${animationDurations.normal}ms`);
  });
});
