import { describe, expect, test } from "vitest";
import {
  enrichGapRowFromSnapshot,
  formatGapPriceContext,
  gapCatalystBody,
  gapStatusDisplayLabel
} from "@/lib/scanner/terminal/enrich-gap-rows";
import type { ScannerTerminalGapRow } from "@/lib/scanner/terminal/scanner-terminal-model";

const BASE: ScannerTerminalGapRow = {
  symbol: "SATS",
  company: null,
  gapPct: 0,
  gapDollars: 0,
  prevClose: 128.13,
  currentPrice: 0,
  volumeVsAvg: 11,
  gapQualityScore: 80,
  statusLabel: "accepted",
  note: null,
  catalystHeadline: "SpaceX IPO repricing",
  catalystDescription: "Direct NAV repricing on IPO day.",
  hasCatalyst: true,
  noCatalystWarning: null,
  marketContextWarning: null,
  fillWatchReason: "",
  monitorNote: "",
  lane: "either",
  isIpoWatch: false,
  unscored: false,
  timeHorizon: "multi_session"
};

describe("enrich-gap-rows", () => {
  test("enrichGapRowFromSnapshot fills company and price from snapshot", () => {
    const row = enrichGapRowFromSnapshot(BASE, {
      symbol: "SATS",
      company_name: "EchoStar Corp",
      last_trade_price: 134.79,
      prev_close: 128.13
    });
    expect(row.company).toBe("EchoStar Corp");
    expect(row.currentPrice).toBe(134.79);
    expect(row.gapPct).toBeCloseTo(5.2, 0);
    expect(formatGapPriceContext(row)).toBe("$128.13 → $134.79");
  });

  test("gapStatusDisplayLabel maps accepted to gap accepted", () => {
    expect(gapStatusDisplayLabel({ ...BASE, statusLabel: "accepted" })).toBe("gap accepted");
    expect(gapStatusDisplayLabel({ ...BASE, isIpoWatch: true, statusLabel: "unscored" })).toBe("IPO - unscored");
  });

  test("gapCatalystBody prefers description over headline", () => {
    const body = gapCatalystBody(BASE);
    expect(body?.text).toContain("NAV repricing");
    expect(body?.italic).toBe(false);
  });
});
