import { describe, expect, test } from "vitest";
import {
  buildSectorThemeGroups,
  collectFunnelSymbols,
  parseSectorRotationEnvelope
} from "@/lib/scanner/terminal/scanner-terminal-sector-themes";

describe("scanner-terminal-sector-themes", () => {
  test("parseSectorRotationEnvelope reads edge cache chips", () => {
    const chips = parseSectorRotationEnvelope({
      data: [
        { symbol: "XLF", label: "Financials", pct5d: 1.2 },
        { symbol: "XLK", label: "Tech", pct5d: -0.5 }
      ]
    });
    expect(chips).toHaveLength(2);
    expect(chips[0]?.symbol).toBe("XLF");
    expect(chips[0]?.pct5d).toBe(1.2);
  });

  test("buildSectorThemeGroups groups funnel symbols by sector ETF", () => {
    const groups = buildSectorThemeGroups(
      [
        { symbol: "XLF", label: "Financials", pct5d: 1.4 },
        { symbol: "XLK", label: "Tech", pct5d: 0.6 }
      ],
      ["JPM", "GS", "NVDA", "MSFT"]
    );
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const fin = groups.find((g) => g.id === "sector-xlf");
    expect(fin?.symbols).toEqual(expect.arrayContaining(["JPM", "GS"]));
    expect(fin?.note).toMatch(/momentum|building|tape/i);
  });

  test("collectFunnelSymbols dedupes desk and gap symbols", () => {
    const symbols = collectFunnelSymbols({
      gapIntelligence: [{ symbol: "ORCL" } as never],
      setups: [{ symbol: "NVDA" } as never],
      swingDesk: { discovery: [{ symbol: "NVDA" } as never], movers_radar: [{ symbol: "AMD" } as never] },
      dayDesk: null,
      watchlistSymbols: ["TSLA"]
    });
    expect(symbols.sort()).toEqual(["AMD", "NVDA", "ORCL", "TSLA"]);
  });
});
