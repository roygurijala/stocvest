import type { FeedCard, FeedLane } from "@/lib/dashboard/trading-room/feed-model";

export type DashboardTradingRoomDeepLink = {
  symbol: string;
  lane: FeedLane;
  /** Stable `${lane}:${symbol}` id used by feed cards. */
  key: string;
};

const INTENT_KEY = "stocvest:trading-room-open-intent";
const INTENT_MAX_AGE_MS = 120_000;

function normalizeLane(raw: string | null | undefined): FeedLane {
  return raw === "day" ? "day" : "swing";
}

export function feedCardIdForDeepLink(symbol: string, lane: FeedLane): string {
  return `${lane}:${symbol.trim().toUpperCase()}`;
}

/** Minimal desk card so Deep Dive can render before feed/tape hydrate. */
export function syntheticFeedCardForDeepLink(intent: DashboardTradingRoomDeepLink): FeedCard {
  return {
    id: intent.key,
    symbol: intent.symbol,
    company: null,
    lane: intent.lane,
    state: "potential",
    bias: "neutral",
    verdict: "Looked up from search — full read below.",
    phase: null,
    price: null,
    changePct: null,
    alignment: null,
    rankScore: 0,
    source: "desk"
  };
}

export function parseDashboardTradingRoomDeepLink(
  params: Pick<URLSearchParams, "get">
): DashboardTradingRoomDeepLink | null {
  const symbol = params.get("symbol")?.trim().toUpperCase() ?? "";
  if (!symbol) return null;
  const lane = normalizeLane(params.get("lane"));
  return { symbol, lane, key: feedCardIdForDeepLink(symbol, lane) };
}

/** Read `?symbol=` from the current location (client-only). */
export function readDashboardDeepLinkKeyFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  return parseDashboardTradingRoomDeepLink(new URLSearchParams(window.location.search))?.key ?? null;
}

export function dashboardTradingRoomHref(symbol: string, lane: FeedLane = "swing"): string {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return "/dashboard";
  const q = new URLSearchParams();
  q.set("symbol", sym);
  q.set("lane", lane);
  return `/dashboard?${q.toString()}`;
}

/** Build a dashboard URL preserving unrelated query params. */
export function buildDashboardSymbolUrl(
  card: FeedCard | null,
  pathname: string,
  existingSearch = ""
): string {
  const base = pathname.trim() || "/dashboard";
  const params = new URLSearchParams(existingSearch);
  if (card) {
    params.set("symbol", card.symbol.trim().toUpperCase());
    params.set("lane", card.lane);
  } else {
    params.delete("symbol");
    params.delete("lane");
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Update the address bar for same-page symbol selection.
 * We use `history.replaceState` only — calling `router.replace` afterward was
 * resetting the bar back to `/dashboard` without query params in Next.js 14.
 */
export function applyDashboardSymbolUrl(
  card: FeedCard | null,
  pathname: string,
  existingSearch: string
): void {
  if (typeof window === "undefined") return;
  const target = buildDashboardSymbolUrl(card, pathname, existingSearch);
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === target) return;
  window.history.replaceState(window.history.state, "", target);
}

/** Stash scanner → dashboard handoff before client navigation (survives SPA routing quirks). */
export function stashTradingRoomOpenIntent(symbol: string, lane: FeedLane = "swing"): void {
  if (typeof sessionStorage === "undefined") return;
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  sessionStorage.setItem(
    INTENT_KEY,
    JSON.stringify({ symbol: sym, lane: normalizeLane(lane), at: Date.now() })
  );
}

export function peekTradingRoomOpenIntent(
  maxAgeMs: number = INTENT_MAX_AGE_MS
): DashboardTradingRoomDeepLink | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { symbol?: string; lane?: string; at?: number };
    if (typeof parsed.at === "number" && Date.now() - parsed.at > maxAgeMs) {
      sessionStorage.removeItem(INTENT_KEY);
      return null;
    }
    const sym = String(parsed.symbol ?? "").trim().toUpperCase();
    if (!sym) return null;
    const lane = normalizeLane(parsed.lane);
    return { symbol: sym, lane, key: feedCardIdForDeepLink(sym, lane) };
  } catch {
    return null;
  }
}

export function clearTradingRoomOpenIntent(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(INTENT_KEY);
}

export function hasPendingTradingRoomOpenIntent(): boolean {
  return resolveTradingRoomOpenIntent() != null;
}

/**
 * Resolve scanner/dashboard handoff from every client source.
 * `useSearchParams` can lag behind `window.location` after `history.replaceState`
 * (same-page card clicks), so the address bar wins when both disagree.
 */
export function resolveTradingRoomOpenIntent(
  searchParams?: Pick<URLSearchParams, "get"> | null
): DashboardTradingRoomDeepLink | null {
  if (typeof window !== "undefined") {
    const fromLocation = parseDashboardTradingRoomDeepLink(new URLSearchParams(window.location.search));
    if (fromLocation) return fromLocation;
  }
  if (searchParams) {
    const fromHook = parseDashboardTradingRoomDeepLink(searchParams);
    if (fromHook) return fromHook;
  }
  return peekTradingRoomOpenIntent();
}
