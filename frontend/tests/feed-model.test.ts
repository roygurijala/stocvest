import { describe, expect, test } from "vitest";
import { buildFeedCards } from "@/lib/dashboard/trading-room/feed-model";
import type { DeskTodayData } from "@/lib/api/desk-today";

const swingDesk: DeskTodayData = {
  generated_at: "2026-06-12T15:00:00Z",
  discovery: [{ symbol: "SPY", gap_percent: 1.2, direction: "up", rank_score: 90, desk: "swing" }],
  movers_radar: [
    { symbol: "ASTN", gap_percent: 27.7, direction: "up", rank_score: 88 },
    { symbol: "ASTX", gap_percent: 18.2, direction: "up", rank_score: 70 }
  ]
};

describe("buildFeedCards", () => {
  test("falls back to swing movers for day lane when day desk cache is null", () => {
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk,
      dayDesk: null,
      swingSetups: [],
      daySetups: [],
      snapshotsBySymbol: new Map(),
      dayTradingSurfaces: true
    });
    const dayCards = cards.filter((c) => c.lane === "day");
    expect(dayCards.length).toBeGreaterThan(0);
    expect(dayCards.some((c) => c.symbol === "ASTN")).toBe(true);
    expect(dayCards.every((c) => c.state === "potential")).toBe(true);
    expect(dayCards.every((c) => c.setupTier === "mover")).toBe(true);
  });

  test("leader card bias follows the composite signal, not the gap move direction", () => {
    const cards = buildFeedCards({
      mode: "day",
      swingDesk: null,
      dayDesk: {
        discovery: [
          // Big green day (gap up) but composite reads short — pill must be bear, not bull.
          {
            symbol: "WYFI",
            gap_percent: 17.9,
            direction: "up",
            rank_score: 90,
            desk: "day",
            verdict: "bearish"
          },
          // No composite verdict cached — pill stays neutral, never the gap direction.
          {
            symbol: "GAPONLY",
            gap_percent: 12.0,
            direction: "up",
            rank_score: 80,
            desk: "day"
          }
        ]
      },
      swingSetups: [],
      daySetups: [],
      snapshotsBySymbol: new Map(),
      dayTradingSurfaces: true
    });
    const wyfi = cards.find((c) => c.symbol === "WYFI");
    const gapOnly = cards.find((c) => c.symbol === "GAPONLY");
    expect(wyfi?.bias).toBe("bear");
    expect(gapOnly?.bias).toBe("neutral");
  });

  test("prefers day desk discovery over swing movers fallback", () => {
    const dayDesk: DeskTodayData = {
      discovery: [
        {
          symbol: "NVDA",
          gap_percent: 4.5,
          direction: "up",
          rank_score: 95,
          desk: "day",
          decision_state: "actionable"
        }
      ],
      movers_radar: []
    };
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk,
      dayDesk,
      swingSetups: [],
      daySetups: [],
      snapshotsBySymbol: new Map(),
      dayTradingSurfaces: true
    });
    const nvda = cards.find((c) => c.lane === "day" && c.symbol === "NVDA");
    expect(nvda?.state).toBe("actionable");
    expect(nvda?.setupTier).toBe("setup");
    expect(cards.filter((c) => c.lane === "day" && c.symbol === "ASTN")).toHaveLength(0);
  });

  test("skips day lane entirely when dayTradingSurfaces is false", () => {
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk,
      dayDesk: null,
      swingSetups: [],
      daySetups: [],
      snapshotsBySymbol: new Map(),
      dayTradingSurfaces: false
    });
    expect(cards.every((c) => c.lane === "swing")).toBe(true);
  });

  test("uses snapshot day_close when last trade is missing", () => {
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk: {
        movers_radar: [{ symbol: "ASTX", gap_percent: 18.2, direction: "up", rank_score: 70 }]
      },
      dayDesk: null,
      swingSetups: [],
      daySetups: [],
      snapshotsBySymbol: new Map([
        [
          "ASTX",
          {
            symbol: "ASTX",
            last_trade_price: null,
            day_close: 12.34
          }
        ]
      ]),
      dayTradingSurfaces: true
    });
    const astx = cards.find((c) => c.symbol === "ASTX");
    expect(astx?.price).toBe(12.34);
  });

  test("high alignment without execution flag is near not actionable", () => {
    const dayDesk: DeskTodayData = {
      discovery: [
        {
          symbol: "ASTN",
          gap_percent: 26,
          direction: "up",
          rank_score: 90,
          desk: "swing",
          alignment_ratio: 1.0,
          decision_state: "blocked",
          execution_actionable: false
        }
      ],
      movers_radar: []
    };
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk: dayDesk,
      dayDesk: null,
      swingSetups: [],
      daySetups: [],
      snapshotsBySymbol: new Map(),
      dayTradingSurfaces: true
    });
    const astn = cards.find((c) => c.symbol === "ASTN");
    expect(astn?.state).toBe("cooling");
    expect(astn?.setupTier).toBe("setup");
  });

  test("scanner setup promotes mover to setup tier on same symbol", () => {
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk: {
        movers_radar: [{ symbol: "ASTN", gap_percent: 27.7, direction: "up", rank_score: 88 }]
      },
      dayDesk: null,
      swingSetups: [
        {
          symbol: "ASTN",
          direction: "up",
          score: 72,
          qualification_tier: "qualifying",
          alignment: { aligned: 5, total: 6, label: "5/6 aligned" }
        }
      ],
      daySetups: [],
      snapshotsBySymbol: new Map(),
      dayTradingSurfaces: true
    });
    const astn = cards.find((c) => c.symbol === "ASTN" && c.lane === "swing");
    expect(astn?.setupTier).toBe("setup");
    expect(astn?.source).toBe("scanner");
  });

  test("downgrades actionable when execution blocked by R/R hint", () => {
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk: {
        discovery: [
          {
            symbol: "SNXX",
            gap_percent: 21.5,
            direction: "up",
            rank_score: 90,
            desk: "swing",
            decision_state: "actionable",
            execution_hint: "Strong setup quality — execution blocked by risk/reward (0.9:1)."
          }
        ],
        movers_radar: []
      },
      dayDesk: null,
      swingSetups: [],
      daySetups: [],
      snapshotsBySymbol: new Map(),
      dayTradingSurfaces: true
    });
    const snxx = cards.find((c) => c.symbol === "SNXX");
    expect(snxx?.state).toBe("near");
  });
});
