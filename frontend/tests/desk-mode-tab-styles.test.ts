import { describe, expect, test } from "vitest";
import { colorTokens } from "@/lib/design-system";
import { getDeskModeTabPresentation } from "@/lib/desk-mode-tab-styles";

describe("getDeskModeTabPresentation", () => {
  test("active swing tab uses violet rail and stronger background than inactive day", () => {
    const colors = colorTokens.dark;
    const swingOn = getDeskModeTabPresentation("dark", "swing", true, colors);
    const dayOff = getDeskModeTabPresentation("dark", "day", false, colors);
    expect(swingOn.railHue).toMatch(/a78bfa|7c3aed/i);
    expect(dayOff.railHue).toMatch(/67e8f9|0e7490/i);
    expect(String(swingOn.tabStyle.border)).toContain("2px");
    expect(String(dayOff.tabStyle.border)).toContain("1px");
    expect(swingOn.tabStyle.fontWeight).toBe(700);
    expect(dayOff.tabStyle.fontWeight).toBe(600);
  });
});
