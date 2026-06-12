import { describe, expect, test } from "vitest";
import { buildThemeSymbolRows } from "@/lib/scanner/terminal/theme-symbol-rows";
import type { ScannerTerminalRadarGroup } from "@/lib/scanner/terminal/scanner-terminal-model";
import type { SnapshotPayload } from "@/lib/api/market";

const GROUP: ScannerTerminalRadarGroup = {
  id: "ipo-spacex",
  title: "SpaceX exposure",
  symbols: ["SATS", "GOOGL"],
  note: "IPO today",
  themeKind: "ipo_ecosystem",
  listedTicker: "SPCX",
  symbolRoles: { SATS: "corporate", GOOGL: "corporate" },
  stakeNotes: { SATS: "NAV proxy" }
};

describe("buildThemeSymbolRows", () => {
  test("merges snapshot gap and stake hints", () => {
    const snapshots = new Map<string, SnapshotPayload>([
      [
        "SATS",
        {
          symbol: "SATS",
          last_trade_price: 135,
          prev_close: 128,
          company_name: "EchoStar"
        }
      ]
    ]);
    const gapBySymbol = new Map([
      [
        "SATS",
        {
          symbol: "SATS",
          company: "EchoStar",
          gapPct: 5.4,
          gapDollars: 7,
          prevClose: 128,
          currentPrice: 135,
          volumeVsAvg: 1.2,
          gapQualityScore: 70,
          statusLabel: "accepted",
          note: null,
          catalystHeadline: null,
          catalystDescription: null,
          hasCatalyst: false,
          noCatalystWarning: null,
          marketContextWarning: null,
          fillWatchReason: "",
          monitorNote: "",
          lane: "either",
          isIpoWatch: false,
          unscored: false,
          timeHorizon: "multi_session"
        }
      ]
    ]);

    const rows = buildThemeSymbolRows({ group: GROUP, snapshots, gapBySymbol });
    expect(rows[0]?.symbol).toBe("SATS");
    expect(rows[0]?.changePct).toBe(5.4);
    expect(rows[0]?.statusLabel).toBe("Gap up");
    expect(rows[0]?.stakeHint).toBe("NAV proxy");
  });
});
