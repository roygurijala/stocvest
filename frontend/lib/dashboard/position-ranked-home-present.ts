/**
 * ADR-004 POS-D13 — Investment home (`/dashboard/invest`) presentation.
 *
 * Pure parsing + filtering + display mapping for the ranked Gem Candidates table
 * (Journey A). Row click → Deep Dive Position tab (Journey B entry). Every value
 * is glass-box: fundamentals/technical scores and the weakest pillar come straight
 * from the deterministic gem-gate screen — no LLM, no hidden blended number.
 *
 * Legal: a "Gem candidate" has passed internal quality gates for informational
 * screening only — never a recommendation, solicitation, or performance guarantee.
 */
import { dashboardTradingRoomHref } from "@/lib/nav/dashboard-trading-room-deeplink";

export type PositionGemTier = "gem" | "strong" | "monitor" | "insufficient";
export type PositionGemTierFilter = PositionGemTier | "all";

/**
 * PERSONAL-MODE action derived deterministically from the tier by the backend
 * (gem/strong -> buy, monitor -> watch, insufficient -> avoid). Present only when the
 * operator's `stocvest_personal_advice_mode_enabled` flag is on; `null` in product mode.
 */
export type PositionGemAction = "buy" | "watch" | "avoid";

export type GemPillar = {
  pillarId: string;
  label: string;
  score: number | null;
  verdict: string;
  dataQuality: string;
};

export type PositionGemCandidate = {
  symbol: string;
  tier: PositionGemTier;
  rank: number;
  compositeScore: number | null;
  verdict: string;
  fundamentalsScore: number | null;
  fundamentalsVerdict: string;
  technicalScore: number | null;
  technicalVerdict: string;
  sectorVerdict: string;
  dataQuality: string;
  weakestPillarId: string | null;
  weakestPillarLabel: string | null;
  rsVsSpy6mPct: number | null;
  signalValidDays: number | null;
  why: string;
  pillars: GemPillar[];
  failingGates: string[];
  /** Personal-mode buy/watch/avoid stance (null in product mode). */
  action: PositionGemAction | null;
  actionLabel: string | null;
};

export type PositionCandidatesResponse = {
  tier: string;
  candidates: PositionGemCandidate[];
  count: number;
  universeSize: number;
  scanGeneratedAt: string | null;
  cached: boolean;
  degraded: boolean;
};

export type PositionGemFilter = {
  tier: PositionGemTierFilter;
  minFundamentals: number | null;
  minTechnical: number | null;
  symbolQuery: string | null;
};

export type PositionGemDisplayRow = {
  symbol: string;
  href: string;
  tier: PositionGemTier;
  tierLabel: string;
  tierCopy: string;
  /** Personal-mode buy/watch/avoid stance (null in product mode). */
  action: PositionGemAction | null;
  actionLabel: string | null;
  rank: number;
  fundamentalsScore: number | null;
  fundamentalsLabel: string;
  technicalScore: number | null;
  trendLabel: string;
  sectorLabel: string;
  weakestLabel: string;
  why: string;
};

const TIER_LABEL: Record<PositionGemTier, string> = {
  gem: "Gem candidate",
  strong: "Strong quality",
  monitor: "Monitor",
  insufficient: "Insufficient"
};

const TIER_COPY: Record<PositionGemTier, string> = {
  gem: "Passes strict quality gates — review pillars before any decision.",
  strong: "Strong fundamentals; structure or environment needs review.",
  monitor: "Mixed read — see weakest pillar.",
  insufficient: "Missing data or failed universe filter."
};

export const DEFAULT_POSITION_GEM_FILTER: PositionGemFilter = {
  tier: "gem",
  minFundamentals: null,
  minTechnical: null,
  symbolQuery: null
};

export function positionGemTierLabel(tier: PositionGemTier): string {
  return TIER_LABEL[tier] ?? "Monitor";
}

export function positionGemTierCopy(tier: PositionGemTier): string {
  return TIER_COPY[tier] ?? TIER_COPY.monitor;
}

function verdictLabel(verdict: string): string {
  const v = (verdict || "").trim().toLowerCase();
  if (v === "bullish") return "Bullish";
  if (v === "bearish") return "Bearish";
  return "Neutral";
}

function normalizeTier(raw: unknown): PositionGemTier {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "gem" || t === "strong" || t === "monitor" || t === "insufficient") return t;
  return "monitor";
}

function normalizeAction(raw: unknown): PositionGemAction | null {
  const a = String(raw ?? "").trim().toLowerCase();
  if (a === "buy" || a === "watch" || a === "avoid") return a;
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parsePillar(raw: unknown): GemPillar | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pillarId = String(r.pillar_id ?? "").trim().toUpperCase();
  if (!pillarId) return null;
  return {
    pillarId,
    label: String(r.label ?? pillarId),
    score: numberOrNull(r.score),
    verdict: String(r.verdict ?? "neutral").trim().toLowerCase(),
    dataQuality: String(r.data_quality ?? "unavailable").trim().toLowerCase()
  };
}

function parseCandidate(raw: unknown): PositionGemCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const symbol = String(r.symbol ?? "").trim().toUpperCase();
  if (!symbol) return null;
  const pillars = Array.isArray(r.pillars)
    ? (r.pillars.map(parsePillar).filter((p): p is GemPillar => p != null) as GemPillar[])
    : [];
  const failingGates = Array.isArray(r.failing_gates)
    ? r.failing_gates.map((g) => String(g)).filter(Boolean)
    : [];
  return {
    symbol,
    tier: normalizeTier(r.tier),
    rank: numberOrNull(r.rank) ?? 0,
    compositeScore: numberOrNull(r.composite_score),
    verdict: String(r.verdict ?? "neutral").trim().toLowerCase(),
    fundamentalsScore: numberOrNull(r.fundamentals_score),
    fundamentalsVerdict: String(r.fundamentals_verdict ?? "neutral").trim().toLowerCase(),
    technicalScore: numberOrNull(r.technical_score),
    technicalVerdict: String(r.technical_verdict ?? "neutral").trim().toLowerCase(),
    sectorVerdict: String(r.sector_verdict ?? "neutral").trim().toLowerCase(),
    dataQuality: String(r.data_quality ?? "unavailable").trim().toLowerCase(),
    weakestPillarId: r.weakest_pillar_id ? String(r.weakest_pillar_id).trim().toUpperCase() : null,
    weakestPillarLabel: r.weakest_pillar_label ? String(r.weakest_pillar_label) : null,
    rsVsSpy6mPct: numberOrNull(r.rs_vs_spy_6m_pct),
    signalValidDays: numberOrNull(r.signal_valid_days),
    why: String(r.why ?? ""),
    pillars,
    failingGates,
    action: normalizeAction(r.action),
    actionLabel: r.action_label ? String(r.action_label) : null
  };
}

export function parsePositionCandidates(json: unknown): PositionCandidatesResponse | null {
  if (!json || typeof json !== "object") return null;
  const r = json as Record<string, unknown>;
  const candidates = Array.isArray(r.candidates)
    ? (r.candidates.map(parseCandidate).filter((c): c is PositionGemCandidate => c != null) as PositionGemCandidate[])
    : [];
  return {
    tier: String(r.tier ?? "gem").trim().toLowerCase(),
    candidates,
    count: numberOrNull(r.count) ?? candidates.length,
    universeSize: numberOrNull(r.universe_size) ?? 0,
    scanGeneratedAt: r.scan_generated_at ? String(r.scan_generated_at) : null,
    cached: r.cached === true,
    degraded: r.degraded === true
  };
}

/** Apply transparent client-side filters (tier + pillar-score sliders + symbol search). */
export function applyPositionGemFilter(
  candidates: readonly PositionGemCandidate[],
  filter: PositionGemFilter
): PositionGemCandidate[] {
  const q = (filter.symbolQuery ?? "").trim().toUpperCase();
  return candidates.filter((c) => {
    if (filter.tier !== "all" && c.tier !== filter.tier) return false;
    if (
      filter.minFundamentals != null &&
      (c.fundamentalsScore == null || c.fundamentalsScore < filter.minFundamentals)
    ) {
      return false;
    }
    if (
      filter.minTechnical != null &&
      (c.technicalScore == null || c.technicalScore < filter.minTechnical)
    ) {
      return false;
    }
    if (q && !c.symbol.includes(q)) return false;
    return true;
  });
}

export function buildPositionGemDisplayRows(
  candidates: readonly PositionGemCandidate[]
): PositionGemDisplayRow[] {
  return candidates.map((c) => ({
    symbol: c.symbol,
    href: dashboardTradingRoomHref(c.symbol, "position", { ref: "invest" }),
    tier: c.tier,
    tierLabel: positionGemTierLabel(c.tier),
    tierCopy: positionGemTierCopy(c.tier),
    action: c.action,
    actionLabel: c.actionLabel,
    rank: c.rank,
    fundamentalsScore: c.fundamentalsScore,
    fundamentalsLabel: verdictLabel(c.fundamentalsVerdict),
    technicalScore: c.technicalScore,
    trendLabel: verdictLabel(c.technicalVerdict),
    sectorLabel: verdictLabel(c.sectorVerdict),
    weakestLabel:
      c.weakestPillarId && c.weakestPillarLabel
        ? `${c.weakestPillarId} · ${c.weakestPillarLabel}`
        : "—",
    why: c.why
  }));
}

// --------------------------------------------------------------- POS-D14 watchlist quality badge

/** Tiers surfaced as a watchlist rail dot — `insufficient` is never badged. */
export type WatchlistQualityTier = "gem" | "strong" | "monitor";

export type WatchlistQualityBadge = {
  tier: WatchlistQualityTier;
  /** Short dot label, e.g. "Gem". */
  short: string;
  /** Full tooltip, e.g. "Gem candidate — weakest pillar: F4 · Valuation". */
  tooltip: string;
};

const TIER_SHORT: Record<WatchlistQualityTier, string> = {
  gem: "Gem",
  strong: "Strong",
  monitor: "Monitor"
};

/**
 * ADR-004 POS-D14 — build the watchlist rail investment-quality badge for one candidate.
 * Returns null for `insufficient` (or missing) candidates so those names carry no dot.
 * The badge is informational (glass-box tier + weakest pillar), never a buy signal.
 */
export function buildWatchlistQualityBadge(
  candidate: PositionGemCandidate | null | undefined
): WatchlistQualityBadge | null {
  if (!candidate) return null;
  const tier = candidate.tier;
  if (tier !== "gem" && tier !== "strong" && tier !== "monitor") return null;
  const weak =
    candidate.weakestPillarId && candidate.weakestPillarLabel
      ? `${candidate.weakestPillarId} · ${candidate.weakestPillarLabel}`
      : candidate.weakestPillarLabel || null;
  const label = positionGemTierLabel(tier);
  return {
    tier,
    short: TIER_SHORT[tier],
    tooltip: weak ? `${label} — weakest pillar: ${weak}` : label
  };
}

/**
 * PERSONAL-MODE — semantic color for the Buy / Watch / Don't-buy action badge.
 * buy → bullish, watch → caution, avoid → bearish; null → muted (never shown).
 */
export function positionActionColor(
  action: PositionGemAction | null,
  colors: { bullish: string; caution: string; bearish: string; textMuted: string }
): string {
  if (action === "buy") return colors.bullish;
  if (action === "watch") return colors.caution;
  if (action === "avoid") return colors.bearish;
  return colors.textMuted;
}

// --------------------------------------------------------------- POS-D8 Trading Room gem rail

/** A single chip in the optional Trading Room "Gem candidates" strip (gem/strong only). */
export type PositionGemRailItem = {
  symbol: string;
  /** Deep-link to the symbol's Position tab (Journey B). */
  href: string;
  tier: "gem" | "strong";
  tierShort: string;
  weakestLabel: string | null;
  /** Personal-mode buy/watch/avoid stance (null in product mode). */
  action: PositionGemAction | null;
  actionLabel: string | null;
};

/**
 * ADR-004 POS-D8 — build the compact Trading Room gem strip from the position candidates
 * screen. Gems first (rank order preserved from the source), then Strong; `monitor` and
 * `insufficient` are excluded so the strip only ever teases genuine quality names. Pure —
 * the component just renders these + a "view all" link to `/dashboard/invest`.
 */
export function buildPositionGemRailItems(
  candidates: readonly PositionGemCandidate[] | null | undefined,
  limit = 6
): PositionGemRailItem[] {
  if (!candidates || limit <= 0) return [];
  const gems = candidates.filter((c) => c.tier === "gem");
  const strong = candidates.filter((c) => c.tier === "strong");
  return [...gems, ...strong].slice(0, limit).map((c) => ({
    symbol: c.symbol,
    href: dashboardTradingRoomHref(c.symbol, "position", { ref: "gem-rail" }),
    tier: c.tier as "gem" | "strong",
    tierShort: TIER_SHORT[c.tier as WatchlistQualityTier],
    weakestLabel:
      c.weakestPillarId && c.weakestPillarLabel
        ? `${c.weakestPillarId} · ${c.weakestPillarLabel}`
        : c.weakestPillarLabel || null,
    action: c.action,
    actionLabel: c.actionLabel
  }));
}

/** Symbol → quality badge map for the watchlist rail (skips `insufficient`). */
export function buildWatchlistQualityMap(
  candidates: readonly PositionGemCandidate[] | null | undefined
): Map<string, WatchlistQualityBadge> {
  const out = new Map<string, WatchlistQualityBadge>();
  if (!candidates) return out;
  for (const c of candidates) {
    const badge = buildWatchlistQualityBadge(c);
    if (badge) out.set(c.symbol.trim().toUpperCase(), badge);
  }
  return out;
}

// --------------------------------------------------------------- POS-AI-6 FE compare matrix

/**
 * ADR-004 POS-AI-6 — deterministic pillar diff matrix for a visual 2–4 name head-to-head on
 * `/dashboard/invest` (Journey C). Pure client-side over the already-fetched candidate rows —
 * no new HTTP call. Mirrors the assistant compare contract: canonical F1..F5 pillar order
 * (then any extra ids, sorted), differences surfaced pillar-by-pillar, and — critically — the
 * matrix NEVER marks a single "best"/"winner" cell. It is informational glass box only.
 */
export const POSITION_COMPARE_MIN = 2;
export const POSITION_COMPARE_MAX = 4;
const COMPARE_PILLAR_ORDER = ["F1", "F2", "F3", "F4", "F5"] as const;

export type PositionCompareCell = {
  score: number | null;
  verdict: string;
  verdictLabel: string;
  dataQuality: string;
};

export type PositionCompareColumn = {
  symbol: string;
  href: string;
  tier: PositionGemTier;
  tierLabel: string;
  fundamentalsScore: number | null;
  technicalScore: number | null;
  weakestLabel: string;
};

export type PositionComparePillarRow = {
  pillarId: string;
  label: string;
  /** Aligned 1:1 with `columns`; `null` = the pillar is absent for that symbol. */
  cells: (PositionCompareCell | null)[];
  /** Informational max−min of the available scores (no winner is implied). */
  spread: number | null;
};

export type PositionCompareMatrix = {
  columns: PositionCompareColumn[];
  pillarRows: PositionComparePillarRow[];
  status: "ok" | "insufficient";
  note: string;
};

/**
 * Resolve the caller's ordered `selectedSymbols` against the fetched candidates and build the
 * compare matrix. Symbols not present in the current screen (e.g. after a tier switch) are
 * dropped; fewer than two resolvable names yields `status:"insufficient"`.
 */
export function buildPositionCompareMatrix(
  candidates: readonly PositionGemCandidate[] | null | undefined,
  selectedSymbols: readonly string[]
): PositionCompareMatrix {
  const bySymbol = new Map<string, PositionGemCandidate>();
  for (const c of candidates ?? []) bySymbol.set(c.symbol.trim().toUpperCase(), c);

  const chosen: PositionGemCandidate[] = [];
  const usedSymbols = new Set<string>();
  for (const raw of selectedSymbols) {
    const sym = String(raw ?? "").trim().toUpperCase();
    if (!sym || usedSymbols.has(sym)) continue;
    const cand = bySymbol.get(sym);
    if (!cand) continue;
    usedSymbols.add(sym);
    chosen.push(cand);
    if (chosen.length >= POSITION_COMPARE_MAX) break;
  }

  const columns: PositionCompareColumn[] = chosen.map((c) => ({
    symbol: c.symbol,
    href: dashboardTradingRoomHref(c.symbol, "position", { ref: "invest-compare" }),
    tier: c.tier,
    tierLabel: positionGemTierLabel(c.tier),
    fundamentalsScore: c.fundamentalsScore,
    technicalScore: c.technicalScore,
    weakestLabel:
      c.weakestPillarId && c.weakestPillarLabel
        ? `${c.weakestPillarId} · ${c.weakestPillarLabel}`
        : "—"
  }));

  if (columns.length < POSITION_COMPARE_MIN) {
    return {
      columns,
      pillarRows: [],
      status: "insufficient",
      note: "Select 2–4 names to compare pillar by pillar."
    };
  }

  const present = new Set<string>();
  const labelById = new Map<string, string>();
  for (const c of chosen) {
    for (const p of c.pillars) {
      present.add(p.pillarId);
      if (!labelById.has(p.pillarId)) labelById.set(p.pillarId, p.label);
    }
  }
  const orderedIds = [
    ...COMPARE_PILLAR_ORDER.filter((id) => present.has(id)),
    ...[...present].filter((id) => !COMPARE_PILLAR_ORDER.includes(id as (typeof COMPARE_PILLAR_ORDER)[number])).sort()
  ];

  const pillarRows: PositionComparePillarRow[] = orderedIds.map((id) => {
    const cells: (PositionCompareCell | null)[] = chosen.map((c) => {
      const p = c.pillars.find((pp) => pp.pillarId === id);
      if (!p) return null;
      return {
        score: p.score,
        verdict: p.verdict,
        verdictLabel: verdictLabel(p.verdict),
        dataQuality: p.dataQuality
      };
    });
    const scores = cells
      .map((cell) => cell?.score)
      .filter((s): s is number => s != null && Number.isFinite(s));
    const spread = scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) : null;
    return { pillarId: id, label: labelById.get(id) ?? id, cells, spread };
  });

  return {
    columns,
    pillarRows,
    status: "ok",
    note: "Pillar-by-pillar differences only — this is not a ranking and names no single \u201Cbest\u201D pick."
  };
}

/**
 * Toggle a symbol in an ordered selection, capped at `POSITION_COMPARE_MAX`. Returns the
 * unchanged list when adding beyond the cap (the UI should disable those checkboxes too).
 */
export function togglePositionCompareSelection(
  selected: readonly string[],
  symbol: string,
  max: number = POSITION_COMPARE_MAX
): string[] {
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (!sym) return [...selected];
  if (selected.includes(sym)) return selected.filter((s) => s !== sym);
  if (selected.length >= max) return [...selected];
  return [...selected, sym];
}

// --------------------------------------------------------------------------- shareable filter URLs

/** Parse `?tier=gem&fund=min:70&tech=min:55&q=AAPL` into a filter (ADR sharable links). */
export function parsePositionGemFilterFromParams(
  params: Pick<URLSearchParams, "get">
): PositionGemFilter {
  const tierRaw = String(params.get("tier") ?? "gem").trim().toLowerCase();
  const tier: PositionGemTierFilter =
    tierRaw === "all" || tierRaw === "gem" || tierRaw === "strong" || tierRaw === "monitor"
      ? (tierRaw as PositionGemTierFilter)
      : "gem";
  return {
    tier,
    minFundamentals: parseMinToken(params.get("fund")),
    minTechnical: parseMinToken(params.get("tech")),
    symbolQuery: (params.get("q") ?? "").trim().toUpperCase() || null
  };
}

export function positionGemFilterToQuery(filter: PositionGemFilter): string {
  const q = new URLSearchParams();
  q.set("tier", filter.tier);
  if (filter.minFundamentals != null) q.set("fund", `min:${filter.minFundamentals}`);
  if (filter.minTechnical != null) q.set("tech", `min:${filter.minTechnical}`);
  if (filter.symbolQuery) q.set("q", filter.symbolQuery);
  return q.toString();
}

function parseMinToken(raw: string | null): number | null {
  if (!raw) return null;
  const match = raw.trim().match(/^min:(-?\d+(?:\.\d+)?)$/i);
  if (!match) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}
