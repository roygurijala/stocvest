import { describe, expect, test } from "vitest";

import {
  buildDashboardSymbolUrl,
  clearDeepDiveLanePreference,
  clearTradingRoomOpenIntent,
  dashboardTradingRoomHref,
  feedCardForDeepDiveLane,
  feedCardIdForDeepLink,
  parseDashboardTradingRoomDeepLink,
  peekDeepDiveLanePreference,
  resolveDeepDiveLaneForCard,
  syntheticFeedCardForDeepLink,
  peekTradingRoomOpenIntent,
  resolveTradingRoomOpenIntent,
  stashDeepDiveLanePreference,
  stashTradingRoomOpenIntent
} from "@/lib/nav/dashboard-trading-room-deeplink";

describe("dashboardTradingRoomHref", () => {
  test("includes symbol and lane", () => {
    const href = dashboardTradingRoomHref("aapl", "swing");
    const u = new URL(href, "http://local.test");
    expect(u.pathname).toBe("/dashboard");
    expect(u.searchParams.get("symbol")).toBe("AAPL");
    expect(u.searchParams.get("lane")).toBe("swing");
  });

  test("day lane is preserved", () => {
    const href = dashboardTradingRoomHref("TSLA", "day");
    const u = new URL(href, "http://local.test");
    expect(u.searchParams.get("lane")).toBe("day");
  });

  test("position lane is preserved", () => {
    const href = dashboardTradingRoomHref("AAPL", "position");
    const u = new URL(href, "http://local.test");
    expect(u.searchParams.get("lane")).toBe("position");
  });

  test("blank symbol falls back to bare dashboard path", () => {
    expect(dashboardTradingRoomHref("")).toBe("/dashboard");
    expect(dashboardTradingRoomHref("   ")).toBe("/dashboard");
  });
});

describe("parseDashboardTradingRoomDeepLink", () => {
  test("parses symbol and lane", () => {
    const params = new URLSearchParams("symbol=nvda&lane=day");
    expect(parseDashboardTradingRoomDeepLink(params)).toEqual({
      symbol: "NVDA",
      lane: "day",
      key: "day:NVDA"
    });
  });

  test("defaults lane to swing", () => {
    const params = new URLSearchParams("symbol=MSFT");
    expect(parseDashboardTradingRoomDeepLink(params)?.lane).toBe("swing");
    expect(parseDashboardTradingRoomDeepLink(params)?.key).toBe("swing:MSFT");
  });

  test("returns null when symbol missing", () => {
    expect(parseDashboardTradingRoomDeepLink(new URLSearchParams("lane=day"))).toBeNull();
  });
});

describe("feedCardIdForDeepLink", () => {
  test("builds lane-prefixed id", () => {
    expect(feedCardIdForDeepLink("powi", "swing")).toBe("swing:POWI");
  });
});

describe("resolveDeepDiveLaneForCard", () => {
  const swingCard = syntheticFeedCardForDeepLink({ symbol: "AAPL", lane: "swing", key: "swing:AAPL" });

  test("position card id wins", () => {
    const card = syntheticFeedCardForDeepLink({ symbol: "MSFT", lane: "position", key: "position:MSFT" });
    expect(resolveDeepDiveLaneForCard(card)).toBe("position");
  });

  test("url intent overrides swing card when symbol matches", () => {
    expect(
      resolveDeepDiveLaneForCard(swingCard, { symbol: "AAPL", lane: "position", key: "position:AAPL" })
    ).toBe("position");
  });

  test("session preference applies when id and url are silent", () => {
    clearDeepDiveLanePreference("NVDA");
    stashDeepDiveLanePreference("NVDA", "position");
    const card = syntheticFeedCardForDeepLink({ symbol: "NVDA", lane: "swing", key: "swing:NVDA" });
    expect(resolveDeepDiveLaneForCard(card)).toBe("position");
    clearDeepDiveLanePreference("NVDA");
  });
});

describe("feedCardForDeepDiveLane", () => {
  test("re-keys card to position id", () => {
    const card = syntheticFeedCardForDeepLink({ symbol: "TSLA", lane: "swing", key: "swing:TSLA" });
    const next = feedCardForDeepDiveLane(card, "position");
    expect(next.id).toBe("position:TSLA");
    expect(next.lane).toBe("swing");
    expect(next.setupTier).toBe("setup");
  });
});

describe("buildDashboardSymbolUrl", () => {
  test("adds symbol and lane query params", () => {
    const url = buildDashboardSymbolUrl(
      {
        id: "swing:TNGX",
        symbol: "TNGX",
        company: null,
        lane: "swing",
        state: "potential",
        bias: "bull",
        verdict: "",
        phase: null,
        price: null,
        changePct: null,
        alignment: null,
        rankScore: 0,
        source: "desk",
        setupTier: "setup"
      },
      "/dashboard",
      ""
    );
    expect(url).toBe("/dashboard?symbol=TNGX&lane=swing");
  });

  test("clears symbol params for market brief", () => {
    expect(buildDashboardSymbolUrl(null, "/dashboard", "symbol=TNGX&lane=swing")).toBe("/dashboard");
  });
});

describe("syntheticFeedCardForDeepLink", () => {
  test("builds a desk card that satisfies selected memo", () => {
    const intent = {
      symbol: "CBRS",
      lane: "swing" as const,
      key: "swing:CBRS"
    };
    const card = syntheticFeedCardForDeepLink(intent);
    expect(card.id).toBe("swing:CBRS");
    expect(card.symbol).toBe("CBRS");
    expect(card.lane).toBe("swing");
  });
});

describe("resolveTradingRoomOpenIntent", () => {
  beforeEach(() => {
    clearTradingRoomOpenIntent();
  });

  test("prefers window location over stale search params", () => {
    const original = window.location.href;
    window.history.replaceState({}, "", "/dashboard?symbol=NVDA&lane=swing");
    try {
      const params = new URLSearchParams("symbol=TSLA&lane=day");
      expect(resolveTradingRoomOpenIntent(params)?.key).toBe("swing:NVDA");
    } finally {
      window.history.replaceState({}, "", original);
    }
  });

  test("falls back to search params when location has no symbol", () => {
    const original = window.location.href;
    window.history.replaceState({}, "", "/dashboard");
    try {
      const params = new URLSearchParams("symbol=TSLA&lane=day");
      expect(resolveTradingRoomOpenIntent(params)?.key).toBe("day:TSLA");
    } finally {
      window.history.replaceState({}, "", original);
    }
  });

  test("falls back to session intent", () => {
    stashTradingRoomOpenIntent("AMD", "swing");
    expect(resolveTradingRoomOpenIntent(new URLSearchParams())?.symbol).toBe("AMD");
  });
});

describe("trading room open intent", () => {
  beforeEach(() => {
    clearTradingRoomOpenIntent();
  });

  test("stash and peek round-trip", () => {
    stashTradingRoomOpenIntent("nvda", "day");
    expect(peekTradingRoomOpenIntent()).toEqual({
      symbol: "NVDA",
      lane: "day",
      key: "day:NVDA"
    });
  });

  test("clear removes intent", () => {
    stashTradingRoomOpenIntent("AAPL", "swing");
    clearTradingRoomOpenIntent();
    expect(peekTradingRoomOpenIntent()).toBeNull();
  });
});
