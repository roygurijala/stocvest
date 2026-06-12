import { describe, expect, test } from "vitest";
import { buildIpoEcosystemRadarGroups } from "@/lib/scanner/terminal/scanner-terminal-ipo-themes";
import type { IpoEcosystemPayload } from "@/lib/api/fetch-ipo-ecosystems";

const SAMPLE: IpoEcosystemPayload[] = [
  {
    trigger_entity: "SpaceX",
    registry_key: "spacex_ecosystem",
    sector_name: "SpaceX ecosystem",
    listed_ticker: "SPCX",
    ipo_date: "2026-06-12",
    s1_filed_date: null,
    target_ipo_window: "June 2026",
    index_inclusion_window_end: "2026-07-17",
    ipo_offer_price: 135,
    corporate_backers: ["GOOGL", "SATS"],
    etf_holders: ["XOVR", "NASA"],
    theme_peers: ["RKLB"],
    tradable_peers: ["GOOGL", "XOVR"],
    stake_notes: {}
  }
];

describe("buildIpoEcosystemRadarGroups", () => {
  test("builds radar cards with exposure title", () => {
    const groups = buildIpoEcosystemRadarGroups(SAMPLE);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toContain("SpaceX");
    expect(groups[0].themeKind).toBe("ipo_ecosystem");
    expect(groups[0].symbols[0]).toBe("SPCX");
    expect(groups[0].symbols).toContain("GOOGL");
    expect(groups[0].symbols).toContain("XOVR");
    expect(groups[0].symbolRoles?.SPCX).toBe("listed");
    expect(groups[0].ipoOfferPrice).toBe(135);
    expect(groups[0].note).toBeTruthy();
  });

  test("returns empty for missing data", () => {
    expect(buildIpoEcosystemRadarGroups(null)).toEqual([]);
  });
});
