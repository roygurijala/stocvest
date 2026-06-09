import { describe, expect, test } from "vitest";
import { colorTokens } from "@/lib/design-system";
import {
  gapCardChrome,
  sectorAccentFromGroupId,
  selectionAccentColor,
  signalCardChrome
} from "@/lib/scanner/terminal/scanner-terminal-present";

const colors = colorTokens.dark;

describe("scanner-terminal-present", () => {
  test("signalCardChrome uses lane left and state bottom borders", () => {
    const chrome = signalCardChrome(
      {
        id: "swing:NVDA",
        symbol: "NVDA",
        company: null,
        lane: "swing",
        state: "actionable",
        bias: "bull",
        alignment: { aligned: 5, total: 6 },
        riskReward: 3.2,
        verdict: "Ready",
        price: 120,
        changePct: 1.2,
        blockerNote: null,
        triggers: ["EMA cross"]
      },
      false,
      true,
      colors
    );
    expect(chrome.borderLeft).toContain("3px solid");
    expect(chrome.borderBottom).toContain(colors.bullish);
  });

  test("gapCardChrome tints bullish gaps green", () => {
    const chrome = gapCardChrome(
      {
        symbol: "SRAD",
        company: null,
        gapPct: 11.4,
        statusLabel: "Gap up",
        note: null,
        lane: "swing"
      },
      false,
      colors
    );
    expect(chrome.borderLeft).toContain(colors.bullish);
    expect(chrome.background).toContain("34,197,94");
  });

  test("sectorAccentFromGroupId maps radar group ids", () => {
    expect(sectorAccentFromGroupId("sector-xlf")).toBe("#fbbf24");
    expect(sectorAccentFromGroupId("sector-xlk")).toBe("#818cf8");
  });

  test("selectionAccentColor follows selection kind", () => {
    expect(selectionAccentColor({ kind: "gap", gapPct: -2 }, colors)).toBe(colors.bearish);
    expect(selectionAccentColor({ kind: "signal", state: "actionable" }, colors)).toBe(colors.bullish);
    expect(selectionAccentColor({ kind: "radar", groupId: "sector-xle" }, colors)).toBe("#34d399");
  });
});
