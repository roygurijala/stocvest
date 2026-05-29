import { describe, expect, test } from "vitest";
import {
  buildSessionActivityRowModel,
  rrProximityNote,
  sortBuildingStructureRows
} from "@/lib/dashboard/opportunity-row-present";
import type { BuildingStructureRow } from "@/lib/dashboard/building-structure-present";
import type { DeskDiscoveryLeader } from "@/lib/api/desk-today";

describe("opportunity-row-present", () => {
  test("rrProximityNote highlights names near swing threshold", () => {
    expect(rrProximityNote(1.6, 2)).toBe("closest to threshold");
    expect(rrProximityNote(0.5, 2)).toBe("wide stop vs target");
  });

  test("session activity row uses compact headline not engine execution_hint", () => {
    const leader: DeskDiscoveryLeader = {
      symbol: "TSLA",
      gap_percent: 1.2,
      direction: "up",
      rank_score: 1,
      desk: "swing",
      alignment_ratio: 1,
      risk_reward: 0.8,
      execution_hint: "Strong setup quality — execution blocked by risk/reward (0.8:1)."
    };
    const row = buildSessionActivityRowModel(leader, {
      rank: 1,
      mode: "swing",
      source: "desk_cache",
      sessionMode: "live"
    });
    expect(row.primaryLine).toMatch(/strong alignment/i);
    expect(row.primaryLine).not.toContain("Strong setup quality");
    expect(row.rrLine).toBe("R/R 0.8:1");
  });

  test("post-close session row uses retrospective copy", () => {
    const leader: DeskDiscoveryLeader = {
      symbol: "ASTC",
      gap_percent: 150,
      direction: "up",
      rank_score: 150,
      desk: "day"
    };
    const row = buildSessionActivityRowModel(leader, {
      rank: 1,
      mode: "day",
      source: "movers_radar",
      sessionMode: "closed"
    });
    expect(row.primaryLine).toMatch(/logged mover/i);
    expect(row.badgeLabel).toMatch(/logged mover/i);
  });

  test("sortBuildingStructureRows orders by highest R/R first", () => {
    const rows: BuildingStructureRow[] = [
      {
        source: "quiet_leader",
        symbol: "LOW",
        quietLeader: {
          symbol: "LOW",
          gap_percent: 0.1,
          direction: "up",
          rank_score: 1,
          desk: "swing",
          risk_reward: 0.5
        }
      },
      {
        source: "quiet_leader",
        symbol: "HIGH",
        quietLeader: {
          symbol: "HIGH",
          gap_percent: 0.2,
          direction: "up",
          rank_score: 2,
          desk: "swing",
          risk_reward: 1.6
        }
      }
    ];
    const sorted = sortBuildingStructureRows(rows);
    expect(sorted[0]?.symbol).toBe("HIGH");
  });
});
