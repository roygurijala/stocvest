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
import type { DeskDiscoveryLeader, DeskMoverRadarRow, DeskTodayData, DeskTodayMode } from "@/lib/api/desk-today";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import type { SnapshotPayload } from "@/lib/api/market";

export type FeedLane = "day" | "swing";

/** Single ranked verdict state. Ordering matters: lower index = hotter. */
export type FeedState = "actionable" | "near" | "potential" | "cooling";

export type FeedBias = "bull" | "bear" | "neutral";

/** Movers are context-only; setups carry full desk / scanner qualification. */
export type FeedSetupTier = "mover" | "setup";

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
  /** B79 — direction confidence (High/Moderate/Low) when the composite is known. */
  directionConfidence?: "High" | "Moderate" | "Low" | null;
  /** Higher = ranked first within a state bucket. */
  rankScore: number;
  source: "desk" | "scanner" | "gap";
  setupTier: FeedSetupTier;
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

function priceFromSnapshot(snap: SnapshotPayload | undefined): number | null {
  if (!snap) return null;
  // Positive guard: over a closed/weekend session Polygon returns day_close = 0,
  // so reject non-positive values and fall back to the prior (Friday) close.
  const pos = (v: number | null | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  return (
    pos(snap.last_trade_price) ??
    pos(snap.day_close) ??
    pos(snap.pre_market_price) ??
    pos(snap.after_hours_price) ??
    pos(snap.prev_close)
  );
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

/**
 * Parse a composite `signal_summary` / verdict into a directional bias. Returns null for
 * non-directional or empty text so callers can choose their own fallback.
 */
function biasFromSignalVerdict(verdict: string | null | undefined): FeedBias | null {
  const v = (verdict || "").trim().toLowerCase();
  if (!v) return null;
  if (/\b(bull|bullish|long)\b/.test(v)) return "bull";
  if (/\b(bear|bearish|short)\b/.test(v)) return "bear";
  if (/\bneutral\b/.test(v)) return "neutral";
  return null;
}

/**
 * Bias for a desk-leader card. The pill represents the SIGNAL, so prefer the composite
 * read (`verdict` = signal_summary) and never let the session/gap MOVE direction stand in
 * for it — a big green or red day is momentum, not a directional signal. When no composite
 * direction is available the pill stays neutral so the card cannot contradict the deep-dive
 * (which re-runs the composite on open).
 */
function leaderBias(leader: DeskDiscoveryLeader): FeedBias {
  return biasFromSignalVerdict(leader.verdict) ?? "neutral";
}

/** Map a desk leader's composite status / alignment into a single verdict state. */
function leaderState(leader: DeskDiscoveryLeader): FeedState {
  const hint = (leader.execution_hint || "").trim().toLowerCase();
  if (hint.includes("execution blocked")) return "near";
  if (leader.execution_actionable === true) return "actionable";
  const decision = (leader.decision_state || "").trim().toLowerCase();
  if (decision === "actionable") return "actionable";
  if (decision === "monitor") return "near";
  if (decision === "blocked") return "cooling";
  const status = (leader.composite_status || leader.verdict || "").trim().toLowerCase();
  if (status.includes("cool") || status.includes("faded") || status.includes("expired")) {
    return "cooling";
  }
  if (status.includes("near") || status.includes("forming") || status.includes("watch")) {
    return "near";
  }
  const ratio = cleanNum(leader.alignment_ratio);
  if (ratio != null) {
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
  /** Pre-resolved company names (scanner + gap intelligence + snapshots) */
  companyBySymbol?: Map<string, string>;
}

function cardFromLeader(
  leader: DeskDiscoveryLeader,
  lane: FeedLane,
  snapshotsBySymbol: Map<string, SnapshotPayload>,
  companyBySymbol?: Map<string, string>
): FeedCard {
  const symbol = leader.symbol.trim().toUpperCase();
  const snap = snapshotsBySymbol.get(symbol);
  const ratio = cleanNum(leader.alignment_ratio);
  // Prefer pre-resolved company names (includes scanner + gap intelligence)
  const company = companyBySymbol?.get(symbol) ?? snap?.company_name?.trim() ?? null;
  return {
    id: `${lane}:${symbol}`,
    symbol,
    company,
    lane,
    state: leaderState(leader),
    bias: leaderBias(leader),
    verdict: leaderVerdict(leader),
    phase: leader.composite_status?.trim() || null,
    price: cleanNum(leader.session_price) ?? priceFromSnapshot(snap),
    changePct: cleanNum(leader.gap_percent) ?? snapChangePct(snap),
    alignment:
      ratio != null ? { aligned: Math.round(ratio * 6), total: 6 } : null,
    directionConfidence: leader.direction_confidence ?? null,
    rankScore: cleanNum(leader.rank_score) ?? 0,
    source: "desk",
    setupTier: "setup",
    lastEvaluatedAt: null
  };
}

function cardFromMover(
  mover: DeskMoverRadarRow,
  lane: FeedLane,
  snapshotsBySymbol: Map<string, SnapshotPayload>,
  companyBySymbol?: Map<string, string>
): FeedCard {
  const symbol = mover.symbol.trim().toUpperCase();
  const snap = snapshotsBySymbol.get(symbol);
  const company = companyBySymbol?.get(symbol) ?? snap?.company_name?.trim() ?? null;
  return {
    id: `${lane}:${symbol}`,
    symbol,
    company,
    lane,
    state: "potential",
    bias: biasFromDirection(mover.direction),
    verdict: "Session mover · not an entry",
    phase: "session activity",
    price: priceFromSnapshot(snap),
    changePct: cleanNum(mover.gap_percent) ?? snapChangePct(snap),
    alignment: null,
    rankScore: cleanNum(mover.rank_score) ?? 0,
    source: "desk",
    setupTier: "mover",
    lastEvaluatedAt: null
  };
}

function cardFromSetup(
  setup: IntradaySetupPayload,
  lane: FeedLane,
  snapshotsBySymbol: Map<string, SnapshotPayload>,
  companyBySymbol?: Map<string, string>
): FeedCard {
  const symbol = setup.symbol.trim().toUpperCase();
  const snap = snapshotsBySymbol.get(symbol);
  // Prefer setup company_name, fallback to pre-resolved map
  const company = setup.company_name?.trim() || companyBySymbol?.get(symbol) || null;
  return {
    id: `${lane}:${symbol}`,
    symbol,
    company,
    lane,
    state: setupState(setup),
    bias: biasFromDirection(setup.direction),
    verdict: setupVerdict(setup),
    phase: setup.confluence_tier?.trim() || null,
    price: cleanNum(setup.last_price) ?? priceFromSnapshot(snap),
    changePct: snapChangePct(snap),
    alignment:
      setup.alignment && typeof setup.alignment.total === "number" && setup.alignment.total > 0
        ? { aligned: setup.alignment.aligned, total: setup.alignment.total }
        : null,
    rankScore: cleanNum(setup.score) ?? 0,
    source: "scanner",
    setupTier: "setup",
    lastEvaluatedAt: null
  };
}

/**
 * Merge desk leaders + scanner setups into a deduped, ranked, capped card list.
 * Scanner setups win over desk leaders for the same symbol/lane because they
 * carry richer fields (company name, alignment label, last price).
 */
export function buildFeedCards(input: BuildFeedInput): FeedCard[] {
  const { snapshotsBySymbol, dayTradingSurfaces, companyBySymbol } = input;
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
      changePct: base.changePct ?? existing.changePct ?? card.changePct,
      setupTier:
        existing.setupTier === "setup" || card.setupTier === "setup" ? "setup" : "mover"
    });
  };

  for (const leader of input.swingDesk?.discovery ?? []) {
    ingest(cardFromLeader(leader, "swing", snapshotsBySymbol, companyBySymbol), false);
  }
  if (dayTradingSurfaces) {
    for (const leader of input.dayDesk?.discovery ?? []) {
      ingest(cardFromLeader(leader, "day", snapshotsBySymbol, companyBySymbol), false);
    }
    const dayDiscoveryCount = input.dayDesk?.discovery?.length ?? 0;
    if (dayDiscoveryCount === 0) {
      const movers =
        (input.dayDesk?.movers_radar?.length ? input.dayDesk.movers_radar : null) ??
        (input.dayDesk == null ? input.swingDesk?.movers_radar : null) ??
        [];
      for (const mover of movers) {
        ingest(cardFromMover(mover, "day", snapshotsBySymbol, companyBySymbol), false);
      }
    }
  }
  for (const setup of input.swingSetups) {
    ingest(cardFromSetup(setup, "swing", snapshotsBySymbol, companyBySymbol), true);
  }
  if (dayTradingSurfaces) {
    for (const setup of input.daySetups) {
      ingest(cardFromSetup(setup, "day", snapshotsBySymbol, companyBySymbol), true);
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
