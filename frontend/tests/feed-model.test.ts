import { describe, expect, test } from "vitest";
import {
  buildFeedCards,
  countDeskSetupCards,
  DEFAULT_FEED_FILTERS,
  findFeedCardForSymbolLane,
  pickTopDeskSetupCard,
  rankAndCapFeed
} from "@/lib/dashboard/trading-room/feed-model";
import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";
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
  test("does not ingest session movers into the default desk feed (QuietFeed only)", () => {
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk,
      dayDesk: null,
      swingSetups: [],
      daySetups: [],
      snapshotsBySymbol: new Map(),
      dayTradingSurfaces: true
    });
    expect(cards.filter((c) => c.lane === "day")).toHaveLength(0);
    expect(cards.some((c) => c.setupTier === "mover")).toBe(false);
  });

  test("excludes desk leaders marked not surface eligible", () => {
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk: {
        discovery: [
          { symbol: "GOOD", gap_percent: 1, direction: "up", rank_score: 90, desk: "swing", desk_surface_eligible: true },
          { symbol: "BAD", gap_percent: 2, direction: "up", rank_score: 88, desk: "swing", desk_surface_eligible: false }
        ]
      },
      dayDesk: null,
      swingSetups: [],
      daySetups: [],
      snapshotsBySymbol: new Map(),
      dayTradingSurfaces: true
    });
    expect(cards.map((c) => c.symbol)).toEqual(["GOOD"]);
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
        discovery: [{ symbol: "ASTX", gap_percent: 18.2, direction: "up", rank_score: 70, desk: "swing" }]
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

  test("scanner setup wins as setup tier on same symbol", () => {
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk: null,
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

describe("rankAndCapFeed UX-D2 defaults", () => {
  const sample: FeedCard[] = [
    {
      id: "swing:A",
      symbol: "A",
      company: null,
      lane: "swing",
      state: "actionable",
      bias: "bull",
      verdict: "v",
      phase: null,
      price: null,
      changePct: null,
      alignment: null,
      rankScore: 90,
      source: "desk",
      setupTier: "setup",
      lastEvaluatedAt: null
    },
    {
      id: "swing:B",
      symbol: "B",
      company: null,
      lane: "swing",
      state: "near",
      bias: "bull",
      verdict: "v",
      phase: null,
      price: null,
      changePct: null,
      alignment: null,
      rankScore: 80,
      source: "desk",
      setupTier: "setup",
      lastEvaluatedAt: null
    },
    {
      id: "swing:C",
      symbol: "C",
      company: null,
      lane: "swing",
      state: "potential",
      bias: "neutral",
      verdict: "v",
      phase: null,
      price: null,
      changePct: null,
      alignment: null,
      rankScore: 70,
      source: "desk",
      setupTier: "setup",
      lastEvaluatedAt: null
    },
    {
      id: "swing:D",
      symbol: "D",
      company: null,
      lane: "swing",
      state: "cooling",
      bias: "neutral",
      verdict: "v",
      phase: null,
      price: null,
      changePct: null,
      alignment: null,
      rankScore: 60,
      source: "desk",
      setupTier: "setup",
      lastEvaluatedAt: null
    }
  ];

  test("DEFAULT_FEED_FILTERS shows actionable + near only", () => {
    const out = rankAndCapFeed(sample, DEFAULT_FEED_FILTERS);
    expect(out.map((c) => c.symbol)).toEqual(["A", "B"]);
  });

  test("potential cap is 2 when filter is all", () => {
    const manyPotential = Array.from({ length: 5 }, (_, i) => ({
      ...sample[2],
      id: `swing:P${i}`,
      symbol: `P${i}`,
      rankScore: 50 - i
    }));
    const out = rankAndCapFeed(manyPotential, { lane: "all", state: "all", bias: "all" });
    expect(out.filter((c) => c.state === "potential")).toHaveLength(2);
  });

  test("cooling hidden unless state filter is all", () => {
    expect(rankAndCapFeed(sample, DEFAULT_FEED_FILTERS).some((c) => c.state === "cooling")).toBe(false);
    const all = rankAndCapFeed(sample, { lane: "all", state: "all", bias: "all" });
    expect(all.some((c) => c.state === "cooling")).toBe(true);
  });
});

describe("pickTopDeskSetupCard", () => {
  const cards: FeedCard[] = [
    {
      id: "swing:POT",
      symbol: "POT",
      company: null,
      lane: "swing",
      state: "potential",
      bias: "neutral",
      verdict: "v",
      phase: null,
      price: null,
      changePct: null,
      alignment: null,
      rankScore: 99,
      source: "desk",
      setupTier: "setup",
      lastEvaluatedAt: null
    },
    {
      id: "swing:ACT",
      symbol: "ACT",
      company: null,
      lane: "swing",
      state: "actionable",
      bias: "bull",
      verdict: "v",
      phase: null,
      price: null,
      changePct: null,
      alignment: null,
      rankScore: 10,
      source: "desk",
      setupTier: "setup",
      lastEvaluatedAt: null
    }
  ];

  test("prefers actionable over higher-ranked potential", () => {
    expect(pickTopDeskSetupCard(cards)?.symbol).toBe("ACT");
  });

  test("respects lane filter", () => {
    const mixed = [
      ...cards,
      {
        id: "day:DAY",
        symbol: "DAY",
        company: null,
        lane: "day",
        state: "actionable",
        bias: "bull",
        verdict: "v",
        phase: null,
        price: null,
        changePct: null,
        alignment: null,
        rankScore: 100,
        source: "desk",
        setupTier: "setup",
        lastEvaluatedAt: null
      }
    ];
    expect(pickTopDeskSetupCard(mixed, { lane: "swing" })?.symbol).toBe("ACT");
  });

  test("countDeskSetupCards filters lane and states", () => {
    expect(countDeskSetupCards(cards, { lane: "swing", states: ["actionable", "near"] })).toBe(1);
  });
});

describe("findFeedCardForSymbolLane", () => {
  const cards: FeedCard[] = [
    {
      id: "day:NVDA",
      symbol: "NVDA",
      company: null,
      lane: "day",
      state: "actionable",
      bias: "bull",
      verdict: "Day setup",
      phase: null,
      price: null,
      changePct: null,
      alignment: null,
      rankScore: 90,
      source: "desk",
      setupTier: "setup",
      lastEvaluatedAt: null
    },
    {
      id: "swing:NVDA",
      symbol: "NVDA",
      company: null,
      lane: "swing",
      state: "near",
      bias: "bull",
      verdict: "Swing setup",
      phase: null,
      price: null,
      changePct: null,
      alignment: null,
      rankScore: 80,
      source: "desk",
      setupTier: "setup",
      lastEvaluatedAt: null
    }
  ];

  test("returns the card for the requested lane only", () => {
    expect(findFeedCardForSymbolLane(cards, "NVDA", "swing")?.verdict).toBe("Swing setup");
    expect(findFeedCardForSymbolLane(cards, "NVDA", "day")?.verdict).toBe("Day setup");
  });

  test("does not fall back to another lane for the same symbol", () => {
    expect(findFeedCardForSymbolLane(cards, "NVDA", "swing")?.lane).toBe("swing");
    expect(findFeedCardForSymbolLane([cards[0]], "NVDA", "swing")).toBeUndefined();
  });
});
