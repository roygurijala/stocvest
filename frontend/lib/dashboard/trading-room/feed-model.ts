/**
 * Trading Room feed model.
 *
 * Maps the production data contracts (Opportunity Desk discovery leaders +
 * scanner setups, keyed against the market tape) into the compact "signal
 * card" vocabulary the redesigned dashboard renders: a ranked, capped,
 * lane-aware list of cards with a single verdict state.
 *
 * This is a PURE module (no React, no fetch) so it can be unit-tested and so
 * the UI never has to reason about which upstream source a card came from.
 */
import type { DeskDiscoveryLeader, DeskTodayData, DeskTodayMode } from "@/lib/api/desk-today";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import type { SnapshotPayload } from "@/lib/api/market";

export type FeedLane = "day" | "swing";

/** Single ranked verdict state. Ordering matters: lower index = hotter. */
export type FeedState = "actionable" | "near" | "potential" | "cooling";

export type FeedBias = "bull" | "bear" | "neutral";

export interface FeedCard {
  /** Stable key — `${lane}:${symbol}`. */
  id: string;
  symbol: string;
  company: string | null;
  lane: FeedLane;
  state: FeedState;
  bias: FeedBias;
  /** Short, human verdict line shown under the bias pill. */
  verdict: string;
  /** Phase / timing label, e.g. "expansion phase", "entry forming". */
  phase: string | null;
  price: number | null;
  changePct: number | null;
  /** Layer alignment when known (e.g. 5 of 6 confirmed). */
  alignment: { aligned: number; total: number } | null;
  /** Higher = ranked first within a state bucket. */
  rankScore: number;
  source: "desk" | "scanner" | "gap";
  /** Per-symbol composite evaluation time when known; desk generated_at as fallback. */
  lastEvaluatedAt?: string | null;
}

/** Hard caps so the feed communicates market conditions, not a firehose. */
export const FEED_STATE_CAPS: Record<FeedState, number> = {
  actionable: 10,
  near: 8,
  potential: 6,
  cooling: 5
};

const STATE_ORDER: Record<FeedState, number> = {
  actionable: 0,
  near: 1,
  potential: 2,
  cooling: 3
};

function cleanNum(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Session change % aligned with the dashboard's snapshot precedence. */
function snapChangePct(s: SnapshotPayload | undefined): number | null {
  if (!s) return null;
  const filter = (v: number | null | undefined): number | null => {
    const n = cleanNum(v);
    if (n == null || n <= -99.5) return null;
    return n;
  };
  return (
    filter(s.change_percent) ??
    filter(s.pre_market_change_percent) ??
    filter(s.after_hours_change_percent) ??
    (() => {
      const last = cleanNum(s.last_trade_price);
      const prev = cleanNum(s.prev_close);
      if (last != null && prev != null && prev !== 0) return ((last - prev) / prev) * 100;
      return null;
    })()
  );
}

function biasFromDirection(direction: string | null | undefined): FeedBias {
  const d = (direction || "").trim().toLowerCase();
  if (d === "up" || d === "long" || d === "bull" || d === "bullish") return "bull";
  if (d === "down" || d === "short" || d === "bear" || d === "bearish") return "bear";
  return "neutral";
}

/** Map a desk leader's composite status / alignment into a single verdict state. */
function leaderState(leader: DeskDiscoveryLeader): FeedState {
  const status = (leader.composite_status || leader.verdict || "").trim().toLowerCase();
  if (status.includes("actionable") || status.includes("qualified") || status.includes("ready")) {
    return "actionable";
  }
  if (status.includes("cool") || status.includes("faded") || status.includes("expired")) {
    return "cooling";
  }
  if (status.includes("near") || status.includes("forming") || status.includes("watch")) {
    return "near";
  }
  const ratio = cleanNum(leader.alignment_ratio);
  if (ratio != null) {
    if (ratio >= 0.8) return "actionable";
    if (ratio >= 0.55) return "near";
    return "potential";
  }
  return "potential";
}

function setupState(setup: IntradaySetupPayload): FeedState {
  if (setup.qualification_tier === "near") return "near";
  if (setup.qualification_tier === "qualifying") return "actionable";
  const aligned = setup.alignment?.aligned ?? null;
  const total = setup.alignment?.total ?? null;
  if (aligned != null && total != null && total > 0) {
    const ratio = aligned / total;
    if (ratio >= 0.8) return "actionable";
    if (ratio >= 0.55) return "near";
    return "potential";
  }
  const score = cleanNum(setup.score);
  if (score != null) {
    if (score >= 75) return "actionable";
    if (score >= 55) return "near";
  }
  return "potential";
}

function leaderVerdict(leader: DeskDiscoveryLeader): string {
  const hint = leader.execution_hint?.trim();
  if (hint) return hint;
  const verdict = leader.verdict?.trim();
  if (verdict) return verdict;
  const ratio = cleanNum(leader.alignment_ratio);
  if (ratio != null) return `${Math.round(ratio * 100)}% layer alignment`;
  return "Monitoring conditions";
}

function setupVerdict(setup: IntradaySetupPayload): string {
  if (setup.alignment?.label?.trim()) return setup.alignment.label.trim();
  const trigger = setup.triggers?.find((t) => t.trim());
  if (trigger) return trigger.trim();
  const score = cleanNum(setup.score);
  if (score != null) return `Setup score ${Math.round(score)}`;
  return "Setup forming";
}

interface BuildFeedInput {
  mode: FeedLane;
  swingDesk: DeskTodayData | null | undefined;
  dayDesk: DeskTodayData | null | undefined;
  swingSetups: IntradaySetupPayload[];
  daySetups: IntradaySetupPayload[];
  snapshotsBySymbol: Map<string, SnapshotPayload>;
  dayTradingSurfaces: boolean;
}

function cardFromLeader(
  leader: DeskDiscoveryLeader,
  lane: FeedLane,
  snapshotsBySymbol: Map<string, SnapshotPayload>
): FeedCard {
  const symbol = leader.symbol.trim().toUpperCase();
  const snap = snapshotsBySymbol.get(symbol);
  const ratio = cleanNum(leader.alignment_ratio);
  return {
    id: `${lane}:${symbol}`,
    symbol,
    company: snap?.company_name?.trim() || null,
    lane,
    state: leaderState(leader),
    bias: biasFromDirection(leader.direction),
    verdict: leaderVerdict(leader),
    phase: leader.composite_status?.trim() || null,
    price: cleanNum(leader.session_price) ?? cleanNum(snap?.last_trade_price),
    changePct: cleanNum(leader.gap_percent) ?? snapChangePct(snap),
    alignment:
      ratio != null ? { aligned: Math.round(ratio * 6), total: 6 } : null,
    rankScore: cleanNum(leader.rank_score) ?? 0,
    source: "desk",
    lastEvaluatedAt: null
  };
}

function cardFromSetup(
  setup: IntradaySetupPayload,
  lane: FeedLane,
  snapshotsBySymbol: Map<string, SnapshotPayload>
): FeedCard {
  const symbol = setup.symbol.trim().toUpperCase();
  const snap = snapshotsBySymbol.get(symbol);
  return {
    id: `${lane}:${symbol}`,
    symbol,
    company: setup.company_name?.trim() || null,
    lane,
    state: setupState(setup),
    bias: biasFromDirection(setup.direction),
    verdict: setupVerdict(setup),
    phase: setup.confluence_tier?.trim() || null,
    price: cleanNum(setup.last_price) ?? cleanNum(snap?.last_trade_price),
    changePct: snapChangePct(snap),
    alignment:
      setup.alignment && typeof setup.alignment.total === "number" && setup.alignment.total > 0
        ? { aligned: setup.alignment.aligned, total: setup.alignment.total }
        : null,
    rankScore: cleanNum(setup.score) ?? 0,
    source: "scanner",
    lastEvaluatedAt: null
  };
}

/**
 * Merge desk leaders + scanner setups into a deduped, ranked, capped card list.
 * Scanner setups win over desk leaders for the same symbol/lane because they
 * carry richer fields (company name, alignment label, last price).
 */
export function buildFeedCards(input: BuildFeedInput): FeedCard[] {
  const { snapshotsBySymbol, dayTradingSurfaces } = input;
  const byId = new Map<string, FeedCard>();

  const ingest = (card: FeedCard, preferred: boolean) => {
    const existing = byId.get(card.id);
    if (!existing) {
      byId.set(card.id, card);
      return;
    }
    // Keep the hotter state; prefer the richer (scanner) source for copy.
    const hotter = STATE_ORDER[card.state] < STATE_ORDER[existing.state] ? card.state : existing.state;
    const base = preferred ? card : existing;
    byId.set(card.id, {
      ...base,
      state: hotter,
      company: base.company ?? existing.company ?? card.company,
      price: base.price ?? existing.price ?? card.price,
      changePct: base.changePct ?? existing.changePct ?? card.changePct
    });
  };

  for (const leader of input.swingDesk?.discovery ?? []) {
    ingest(cardFromLeader(leader, "swing", snapshotsBySymbol), false);
  }
  if (dayTradingSurfaces) {
    for (const leader of input.dayDesk?.discovery ?? []) {
      ingest(cardFromLeader(leader, "day", snapshotsBySymbol), false);
    }
  }
  for (const setup of input.swingSetups) {
    ingest(cardFromSetup(setup, "swing", snapshotsBySymbol), true);
  }
  if (dayTradingSurfaces) {
    for (const setup of input.daySetups) {
      ingest(cardFromSetup(setup, "day", snapshotsBySymbol), true);
    }
  }

  return Array.from(byId.values());
}

export interface FeedFilters {
  lane: "all" | FeedLane;
  state: "all" | "actionable" | "near" | "potential";
  bias: "all" | "long" | "short";
}

export const DEFAULT_FEED_FILTERS: FeedFilters = { lane: "all", state: "all", bias: "all" };

function matchesFilters(card: FeedCard, filters: FeedFilters): boolean {
  if (filters.lane !== "all" && card.lane !== filters.lane) return false;
  if (filters.bias === "long" && card.bias !== "bull") return false;
  if (filters.bias === "short" && card.bias !== "bear") return false;
  if (filters.state === "actionable" && card.state !== "actionable") return false;
  if (filters.state === "near" && card.state !== "near") return false;
  if (filters.state === "potential" && card.state !== "potential") return false;
  return true;
}

/**
 * Sort by state bucket (hot first), then rank score, then symbol; apply per-state
 * caps so each bucket stays meaningful. Returns the flat, display-ready list.
 */
export function rankAndCapFeed(cards: FeedCard[], filters: FeedFilters = DEFAULT_FEED_FILTERS): FeedCard[] {
  const filtered = cards.filter((c) => matchesFilters(c, filters));
  const sorted = [...filtered].sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (byState !== 0) return byState;
    if (b.rankScore !== a.rankScore) return b.rankScore - a.rankScore;
    return a.symbol.localeCompare(b.symbol);
  });
  const seen: Record<FeedState, number> = { actionable: 0, near: 0, potential: 0, cooling: 0 };
  const out: FeedCard[] = [];
  for (const card of sorted) {
    if (seen[card.state] >= FEED_STATE_CAPS[card.state]) continue;
    seen[card.state] += 1;
    out.push(card);
  }
  return out;
}

/** Group display-ready cards by lane for the two-lane feed layout. */
export function groupFeedByLane(cards: FeedCard[]): { day: FeedCard[]; swing: FeedCard[] } {
  const day: FeedCard[] = [];
  const swing: FeedCard[] = [];
  for (const card of cards) {
    if (card.lane === "day") day.push(card);
    else swing.push(card);
  }
  return { day, swing };
}
