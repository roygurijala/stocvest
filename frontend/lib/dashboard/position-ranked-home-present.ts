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
    failingGates
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
