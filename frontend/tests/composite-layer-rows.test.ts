import { describe, expect, test } from "vitest";

import { compositeToSignalsLayerRows } from "@/lib/signals/composite-layer-rows";

describe("compositeToSignalsLayerRows", () => {
  test("maps unavailable technical without score to null not zero", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "technical",
          status: "unavailable",
          score: null,
          verdict: "neutral",
          reasoning: "Insufficient bar data. Market may be closed."
        }
      ]
    });
    const tech = rows.find((r) => r.key === "technical");
    expect(tech?.score).toBeNull();
    expect(tech?.status).toBe("As of close");
  });

  test("maps as_of_close API status with verdict and label", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "technical",
          status: "as_of_close",
          score: 58,
          verdict: "bullish",
          reasoning: "As of last close (daily structure — intraday VWAP/ORB not active until the regular session)."
        }
      ]
    });
    const tech = rows.find((r) => r.key === "technical");
    expect(tech?.status).toBe("Bullish");
    expect(tech?.statusLabel).toMatch(/As of close/i);
    expect(tech?.score).toBe(58);
  });

  test("sector row shows benchmark label when resolved", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "sector",
          status: "available",
          score: 62,
          verdict: "bullish",
          sector_etf: "ITA",
          sector_display_name: "Aerospace & Defense",
          sector_resolution_state: "resolved"
        }
      ]
    });
    const sector = rows.find((r) => r.key === "sector");
    expect(sector?.statusLabel).toBe("Aerospace & Defense (ITA)");
  });

  test("sector row shows benchmark while cache resolves", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "sector",
          status: "unavailable",
          score: null,
          verdict: "neutral",
          sector_display_name: "Aerospace & Defense",
          sector_etf: "ITA",
          sector_resolution_state: "pending_cache_refresh"
        }
      ]
    });
    const sector = rows.find((r) => r.key === "sector");
    expect(sector?.statusLabel).toBe("Aerospace & Defense (ITA) · resolving");
    expect(sector?.sectorCachePending).toBe(true);
  });

  test("preserves legitimate technical score of zero", () => {
    const rows = compositeToSignalsLayerRows({
      layers: [
        {
          layer: "technical",
          status: "available",
          score: 0,
          verdict: "bearish",
          reasoning: "Strong bearish stack"
        }
      ]
    });
    const tech = rows.find((r) => r.key === "technical");
    expect(tech?.score).toBe(0);
    expect(tech?.status).toBe("Bearish");
  });
});
