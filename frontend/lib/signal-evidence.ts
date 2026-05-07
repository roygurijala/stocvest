import type { NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { coerceSnapshotForReferenceLevels } from "@/lib/snapshot-reference-levels";

export type EvidenceDirection = "bullish" | "bearish" | "neutral";
export type EvidenceStatus = "Bullish" | "Bearish" | "Neutral" | "Unavailable" | "As of close";

/** Per-theme sector multiplier row from composite `layers[].geo_event_details`. */
export interface GeoEventDetailRow {
  event_type: string;
  score: number;
  sector_multiplier: number | null;
}

/** Structured geopolitical exposure (real/swing composite) for the evidence card. */
export interface GeopoliticalLayerExtras {
  impactSectorKey: string;
  impactSectorLabel: string;
  stockExposureScore: number | null;
  exposureBand: "low" | "moderate" | "high" | null;
  exposureSummary: string | null;
  activeEvents: Array<{ event_type: string; score: number }>;
  eventDetails: GeoEventDetailRow[];
  /** Structural baseline (risk / sensitivity scale) — always present once geo layer is hydrated. */
  geoBaselineScore?: number;
  geoBaselineSummary?: string;
  /** True when headlineKeyword events augmented the geo read; false = structural baseline only. */
  geoHasLiveEvents?: boolean;
  geoPrimaryTheme?: string | null;
}

export interface NewsLayerRating {
  action: string;
  rating: string;
  firm: string;
  /** ISO date string (`YYYY-MM-DD`) */
  date: string;
}

export interface NewsLayerGuidance {
  type: string;
  headline: string;
  /** ISO date string (`YYYY-MM-DD`) */
  date: string;
}

export interface NewsLayerEarningsResult {
  beat: boolean | null;
  eps_surprise_pct: number | null;
  period: string;
}

/** Macro calendar / FRED extras from composite `layers[].macro` row. */
export interface MacroUpcomingEventWire {
  event_id: string;
  name: string;
  category: string;
  status: string;
  importance: number;
  hours_until: number;
  warning: string | null;
  scheduled_time: string;
}

export interface MacroYieldCurveWire {
  yield_2yr: number;
  yield_10yr: number;
  spread: number;
  regime: "normal" | "flat" | "inverted";
  label: string;
  chip: string;
}

/** Sector mapper / cache resolution (composite `layers[].sector_resolution_state`). */
export type SectorResolutionStateWire = "resolved" | "pending_cache_refresh" | "unmapped";

/** Redis-backed daily ETF vs SPY session row when API includes `sector_daily_sessions`. */
export interface SectorDailySessionWire {
  date: string;
  etf_pct: number;
  spy_pct: number;
  relative: number;
  outperformed: boolean;
  volume_ratio: number;
}

/** Macro-sector-technical synthesis from composite top-level `alignment` (additive). */
export type CompositeAlignmentLevelWire = "full" | "strong" | "moderate" | "weak" | "conflict";

export interface CompositeAlignmentWire {
  level: CompositeAlignmentLevelWire;
  score_modifier: number;
  label: string;
  detail: string;
  chip: string;
  is_tailwind: boolean;
  is_headwind: boolean;
  is_counter_trend: boolean;
  macro_direction: string;
  sector_direction: string;
  technical_direction: string;
  macro_supports: boolean;
  sector_supports: boolean;
  technical_supports: boolean;
}

export interface EvidenceLayer {
  key: string;
  icon: string;
  name: string;
  status: EvidenceStatus;
  weightPercent: number;
  explanation: string;
  keyPoints: string[];
  contributionScore: number;
  freshnessLabel: string;
  macro_warnings?: string[];
  macro_risk_level?: "low" | "moderate" | "elevated" | "critical";
  upcoming_events?: MacroUpcomingEventWire[];
  yield_curve?: MacroYieldCurveWire | null;
  /** Present when API returns geo sector mapping + themes (geopolitical layer only). */
  geo?: GeopoliticalLayerExtras;
  /** Composite news layer extras (when BFF merges `layers[].news`). */
  wim_summary?: string;
  articles_count?: number;
  news_data_state?: string;
  latest_rating?: NewsLayerRating;
  latest_guidance?: NewsLayerGuidance;
  earnings_result?: NewsLayerEarningsResult;
  /** Sector layer momentum + resolver state (composite real/swing APIs). */
  sector_resolution_state?: SectorResolutionStateWire | null;
  sector_persistence?: number | null;
  sector_sessions_leading?: number | null;
  sector_total_sessions?: number | null;
  sector_trending?: string | null;
  sector_rank_1d?: number | null;
  sector_rank_5d?: number | null;
  sector_interpretation?: string | null;
  sector_data_available?: boolean | null;
  sector_daily_sessions?: SectorDailySessionWire[];
}

export interface SignalEvidenceConfluence {
  confluence_score: number;
  confluence_tier: string;
  is_confluence_alert: boolean;
  confirming_signals: Array<{ label: string; detail?: string }>;
  conflicting_signals: Array<{ label: string; detail?: string }>;
  n_confirming: number;
  n_conflicting: number;
  historical_note: string;
  confluence_disclaimer: string;
}

/** Actionable insight block (swing composite API + deterministic fallbacks). Not investment advice. */
export interface SignalEvidenceInsight {
  signal_score: number;
  trend_strength: string;
  trend_direction: string;
  risk_reward: number;
  rr_warning?: boolean;
  rr_quality?: "low" | "acceptable" | "good" | "strong";
  market_regime: string;
  confirming_signals: Array<{ label: string; detail?: string }>;
  conflicting_signals: Array<{ label: string; detail?: string }>;
  catalysts: Array<{ text: string; sentiment: string; source?: string; published_at?: string; sentiment_score?: number }>;
  risk_factors: string[];
  risk_factors_detailed?: Array<{ label: string; severity: "high" | "medium" | "low"; detail: string }>;
  signal_parameters: string;
  historical_entry_zone: { low: number; high: number } | null;
  reference_target_1: number | null;
  reference_target_2: number | null;
  reference_stop_level: number | null;
  /** Session VWAP when available; modal uses this before `keyLevels.vwap`. */
  vwap: number | null;
  vwap_state?: string;
  vwap_display?: string;
  vwap_tooltip?: string;
  is_complete?: boolean;
  missing_fields?: string[];
  alignment_ratio?: number;
  conflicted_layers?: string[];
}

/** Mirrors backend ``VWAPState`` for client display. */
export const VWAP_STATE = {
  PRE_MARKET: "pre_market",
  FORMING: "forming",
  AVAILABLE: "available",
  POST_MARKET: "post_market"
} as const;

export function getVWAPTooltip(state?: string): string {
  const tooltips: Record<string, string> = {
    pre_market: "VWAP resets at 9:30 AM ET. Not available pre-market.",
    forming: "VWAP is calculating from early session bars.",
    available: "Volume Weighted Average Price since market open.",
    post_market: "VWAP is an RTH-only indicator. Not available post-market."
  };
  return tooltips[state ?? ""] ?? "Intraday volume-weighted price level.";
}

export function getVWAPDisplay(
  vwapValue: number | null | undefined,
  vwapState: string | undefined,
  price: number | null | undefined,
  vwapDisplay: string | undefined,
  serverTooltip?: string | undefined
): { label: string; muted: boolean; tooltip: string; state?: string } {
  if (vwapDisplay && vwapDisplay.trim()) {
    const st = vwapState?.trim();
    const muted = st !== VWAP_STATE.AVAILABLE;
    const tip = (serverTooltip && serverTooltip.trim()) || (st ? getVWAPTooltip(st) : getVWAPTooltip());
    return {
      label: vwapDisplay.trim(),
      muted,
      tooltip: tip,
      state: st
    };
  }
  if (vwapValue != null && Number.isFinite(vwapValue) && vwapValue > 0) {
    const direction = price != null && Number.isFinite(price) && price >= vwapValue ? "— Above" : "— Below";
    return {
      label: `VWAP $${vwapValue.toFixed(2)} ${direction}`.trim(),
      muted: false,
      tooltip: getVWAPTooltip(VWAP_STATE.AVAILABLE),
      state: VWAP_STATE.AVAILABLE
    };
  }
  return {
    label: "VWAP starts at 9:30 ET",
    muted: true,
    tooltip: "VWAP resets each session at open.",
    state: VWAP_STATE.PRE_MARKET
  };
}

/** Client-side mirror of intraday-only chip markers (defense when API mis-scopes). */
const INTRADAY_CHIP_MARKERS = ["(session)", "session", "orb", "opening range", "opening drive", "intraday"] as const;

export function isChipAllowedForSwing(chip: string): boolean {
  const lower = chip.toLowerCase();
  for (const marker of INTRADAY_CHIP_MARKERS) {
    if (lower.includes(marker)) return false;
  }
  if (lower.includes("vwap") && !lower.includes("daily")) return false;
  if ((lower.includes("ema9") || lower.includes("9 ema")) && !lower.includes("daily") && !lower.includes("dma")) {
    return false;
  }
  return true;
}

export function filterChipsForMode(chips: string[], mode: "day" | "swing"): string[] {
  if (mode !== "swing") return chips;
  return chips.filter(isChipAllowedForSwing);
}

export interface SignalEvidenceData {
  symbol: string;
  direction: EvidenceDirection;
  /** Same string as dashboard Top Signals (e.g. long / short), not swing BULLISH copy. */
  directionBadgeLabel: string;
  confidencePercent: number;
  layers: EvidenceLayer[];
  aiVerdict: string;
  aiFreshnessLabel: string;
  keyLevels: {
    vwap?: number | null;
    vwap_state?: string;
    vwap_display?: string;
    vwap_tooltip?: string;
    support?: number | null;
    resistance?: number | null;
    orHigh?: number | null;
    orLow?: number | null;
  };
  /** Snapshot last when `buildEvidenceFromSetup` had a quote; aligns client R/R with swing composite geometry. */
  lastTradePrice?: number | null;
  prevClose?: number | null;
  updatedLabel: string;
  newsFreshnessLabel: string;
  /** ISO string used for `updatedLabel`; lets the card clamp invalid or very stale timestamps. */
  updatedAtIso?: string | null;
  earningsRisk?: {
    daysUntil: number;
    reportTime: "before_market" | "after_market" | "during_market" | "unknown";
  } | null;
  confluence?: SignalEvidenceConfluence | null;
  /** Populated from swing composite JSON or derived locally for consistent evidence UI. */
  insight?: SignalEvidenceInsight | null;
  /** Set when evidence is merged from composite day/swing API responses. */
  compositeMode?: "day" | "swing";
  signal_basis?: string;
  signal_basis_label?: string;
  /** Present after composite enrichment when backend sends `alignment`. */
  alignment?: CompositeAlignmentWire | null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const MAX_LAYER_STALE_MS = 30 * 24 * 60 * 60 * 1000;

export function timeAgoLabelFromIso(iso: string | null | undefined): string {
  const ts = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(ts)) return "Updated recently";
  const delta = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (delta < 60) return `Updated ${delta}s ago`;
  if (delta < 3600) return `Updated ${Math.floor(delta / 60)}m ago`;
  return `Updated ${Math.floor(delta / 3600)}h ago`;
}

/** Same shape as time-ago labels but clamps invalid / future / >30d (avoids bogus layer lines like 198443h ago). */
export function layerFreshnessFromIso(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === "") {
    return "Just now";
  }
  const ms = Date.parse(String(iso));
  if (!Number.isFinite(ms)) {
    return "Just now";
  }
  const ageMs = Date.now() - ms;
  if (ageMs < 0 || ageMs > MAX_LAYER_STALE_MS) {
    return "Just now";
  }
  const delta = Math.max(1, Math.floor(ageMs / 1000));
  if (delta < 60) return `Updated ${delta}s ago`;
  if (delta < 3600) return `Updated ${Math.floor(delta / 60)}m ago`;
  return `Updated ${Math.floor(delta / 3600)}h ago`;
}

function evidenceDirectionFromSetup(raw: string | undefined): EvidenceDirection {
  const d = (raw ?? "").trim().toLowerCase();
  if (d === "long" || d === "bullish") {
    return "bullish";
  }
  if (d === "short" || d === "bearish") {
    return "bearish";
  }
  return "neutral";
}

/** Verbatim scanner/dashboard wording for the badge (must match Top Signals row). */
function directionBadgeFromSetup(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  return t.length > 0 ? t : "neutral";
}

function statusFromScore(score: number): EvidenceStatus {
  if (score >= 66) return "Bullish";
  if (score <= 38) return "Bearish";
  return "Neutral";
}

function relativeNewsTime(iso: string | null | undefined): string {
  const ts = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ts)) {
    return "recently";
  }
  const delta = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/** Relative time for catalyst headlines; "—" when timestamp missing or invalid. */
export function catalystPublishedAgo(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === "") {
    return "—";
  }
  const ts = Date.parse(String(iso));
  if (!Number.isFinite(ts)) {
    return "—";
  }
  const deltaSec = Math.floor((Date.now() - ts) / 1000);
  if (deltaSec < 0) {
    return "—";
  }
  const delta = Math.max(1, deltaSec);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/** First usable headline line for evidence chips (Polygon sometimes omits `title`). */
function firstNewsSnippetForEvidence(articles: NewsPayload[]): string | undefined {
  for (const a of articles) {
    const t = a.title?.trim();
    if (t) return t.slice(0, 40);
    const d = a.description?.trim();
    if (d) return d.slice(0, 40);
    const imp = a.impact_summary?.trim();
    if (imp) return imp.slice(0, 40);
  }
  return undefined;
}

function firstArticlePublishedAt(articles: NewsPayload[]): string | undefined {
  for (const a of articles) {
    const p = a.published_at ?? a.published_utc;
    if (p != null && String(p).trim() !== "") return String(p);
  }
  return undefined;
}

export interface BuildEvidenceOptions {
  symbolNewsArticles?: NewsPayload[];
  earningsRiskDays?: number;
  earningsReportTime?: "before_market" | "after_market" | "during_market" | "unknown";
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Snapshot-backed bullets so the evidence modal is never placeholder-only (dashboard / scanner paths). */
function keyPointsTechnicalFromSnapshot(
  snap: SnapshotPayload | null,
  technicalScore: number,
  symbolUpper: string
): string[] {
  const last = snap?.last_trade_price;
  const prev = snap?.prev_close;
  const pts: string[] = [];
  if (typeof last === "number" && Number.isFinite(last)) {
    pts.push(`Last ${fmtUsd(last)}`);
  }
  if (typeof last === "number" && typeof prev === "number" && prev > 0) {
    const chg = ((last - prev) / prev) * 100;
    pts.push(`vs prev close ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`);
  }
  const vwap = snap?.day_vwap;
  if (typeof vwap === "number" && Number.isFinite(vwap)) {
    pts.push(`Day VWAP ${fmtUsd(vwap)}`);
  } else if (typeof snap?.day_low === "number" && typeof snap?.day_high === "number") {
    pts.push(`Session range ${fmtUsd(snap.day_low)}–${fmtUsd(snap.day_high)}`);
  }
  if (pts.length === 0) {
    return [
      `Quote pending for ${symbolUpper}`,
      "Full intraday stack needs regular-session data",
      `Model tilt ~${Math.round(technicalScore)} / 100`
    ];
  }
  if (pts.length < 3) {
    pts.push(`Snapshot tilt ~${Math.round(technicalScore)} / 100`);
  }
  return pts.slice(0, 3);
}

function keyPointsMacroFallback(macroScore: number): string[] {
  return [
    "SPY / QQQ trend and VIX tone when live",
    "Economic calendar weight on server pass",
    `Layer blend ~${Math.round(macroScore)} / 100`
  ];
}

function keyPointsSectorFallback(sectorScore: number, symbolUpper: string): string[] {
  return [
    "Sector ETF vs SPX from classification",
    `Context: ${symbolUpper}`,
    `Layer blend ~${Math.round(sectorScore)} / 100`
  ];
}

function keyPointsGeoFallback(geoScore: number): string[] {
  return [
    "Geo headline stress vs baseline",
    "Elevated risk discounts fragile squeezes",
    `Layer blend ~${Math.round(geoScore)} / 100`
  ];
}

function keyPointsInternalsFallback(internalsScore: number): string[] {
  return [
    "Breadth and VIX participation",
    "A/D when tape data is available",
    `Layer blend ~${Math.round(internalsScore)} / 100`
  ];
}

function reasoningToKeyPoints(reasoning: string, max = 3): string[] {
  const parts = reasoning
    .split(/\.(?:\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
  return parts.length ? parts : [reasoning.trim()].filter(Boolean);
}

function synthKeyPointsFromLayerApi(match: Record<string, unknown>): string[] {
  const out: string[] = [];
  const score = match.score;
  if (typeof score === "number" && Number.isFinite(score)) {
    out.push(`Layer score ${Math.round(score)}`);
  }
  const verdict = typeof match.verdict === "string" ? match.verdict.trim() : "";
  if (verdict) {
    out.push(`${verdict.charAt(0).toUpperCase()}${verdict.slice(1)} verdict`);
  }
  const st = typeof match.status === "string" ? match.status.trim() : "";
  if (st === "unavailable") {
    out.push("Live layer data unavailable");
  } else if (st && st !== "available") {
    out.push(`Status: ${st}`);
  }
  return out.slice(0, 4);
}

/**
 * Real-composite `layers[]` rows carry authoritative verdict/score; chips were merged into keyPoints
 * but the badge still came from `buildEvidenceFromSetup` heuristics — keep badge + bar chart aligned.
 */
function evidencePatchFromApiLayer(match: Record<string, unknown>, layerKey?: string): Partial<EvidenceLayer> {
  const patch: Partial<EvidenceLayer> = {};
  const raw = match.score;
  const layerStatus = String(match.status ?? "").trim().toLowerCase();
  if (layerStatus === "unavailable") {
    // Closed-session convention: keep last computed layer score, but mark it explicitly as stale close data.
    if (typeof raw === "number" && Number.isFinite(raw)) {
      patch.contributionScore = clamp(Math.round(raw), 0, 100);
      patch.status = "As of close";
      return patch;
    }
    patch.contributionScore = 0;
    patch.status = "Unavailable";
    return patch;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    patch.contributionScore = clamp(Math.round(raw), 0, 100);
  }
  const verdict = String(match.verdict ?? "").trim().toLowerCase();
  if (verdict === "bullish") {
    patch.status = "Bullish";
  } else if (verdict === "bearish") {
    patch.status = "Bearish";
  } else if (verdict === "neutral") {
    patch.status = "Neutral";
  } else if (patch.contributionScore !== undefined) {
    patch.status = statusFromScore(patch.contributionScore);
  }

  const lk = (layerKey ?? "").trim().toLowerCase();
  if (lk === "news") {
    const wim = typeof match.wim_summary === "string" && match.wim_summary.trim() ? match.wim_summary.trim() : undefined;
    if (wim) patch.wim_summary = wim;
    const ds = typeof match.data_state === "string" ? match.data_state.trim() : undefined;
    if (ds) patch.news_data_state = ds;
    const ac = numOrNull(match.article_count ?? match.articles_count);
    if (ac != null) patch.articles_count = ac;

    const lrRaw = match.latest_rating;
    if (lrRaw && typeof lrRaw === "object") {
      const o = lrRaw as Record<string, unknown>;
      patch.latest_rating = {
        action: String(o.action ?? "").trim(),
        rating: String(o.rating ?? "").trim(),
        firm: String(o.firm ?? "").trim(),
        date: String(o.date ?? o.date_str ?? "").trim()
      };
    }
    const lgRaw = match.latest_guidance;
    if (lgRaw && typeof lgRaw === "object") {
      const g = lgRaw as Record<string, unknown>;
      patch.latest_guidance = {
        type: String(g.type ?? "").trim(),
        headline: String(g.headline ?? "").trim(),
        date: String(g.date ?? g.date_str ?? "").trim()
      };
    }
    const erRaw = match.earnings_result;
    if (erRaw && typeof erRaw === "object") {
      const e = erRaw as Record<string, unknown>;
      const beatRaw = e.beat;
      const beatParsed: boolean | null = typeof beatRaw === "boolean" ? beatRaw : null;
      patch.earnings_result = {
        beat: beatParsed,
        eps_surprise_pct:
          typeof e.eps_surprise_pct === "number" && Number.isFinite(e.eps_surprise_pct) ? e.eps_surprise_pct : null,
        period: String(e.period ?? "").trim()
      };
    }
  }
  if (lk === "macro") {
    const mw = match.macro_warnings;
    if (Array.isArray(mw)) {
      patch.macro_warnings = mw.map((x) => String(x)).filter((s) => s.length > 0);
    }
    const mr = String(match.macro_risk_level ?? "").trim().toLowerCase();
    if (mr === "low" || mr === "moderate" || mr === "elevated" || mr === "critical") {
      patch.macro_risk_level = mr;
    }
    const ue = match.upcoming_events;
    if (Array.isArray(ue)) {
      const rows: MacroUpcomingEventWire[] = [];
      for (const item of ue) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const eid = String(o.event_id ?? "").trim();
        const nm = String(o.name ?? "").trim();
        if (!eid || !nm) continue;
        const st = String(o.status ?? "").trim().toLowerCase();
        const imp = numOrNull(o.importance);
        const hu = numOrNull(o.hours_until);
        rows.push({
          event_id: eid,
          name: nm,
          category: String(o.category ?? "").trim(),
          status: st,
          importance: imp ?? 0,
          hours_until: hu ?? 0,
          warning: o.warning == null ? null : String(o.warning),
          scheduled_time: String(o.scheduled_time ?? "").trim()
        });
      }
      if (rows.length) patch.upcoming_events = rows;
    }
    const ycRaw = match.yield_curve;
    if (ycRaw && typeof ycRaw === "object") {
      const y = ycRaw as Record<string, unknown>;
      const y2 = numOrNull(y.yield_2yr);
      const y10 = numOrNull(y.yield_10yr);
      const sp = numOrNull(y.spread);
      const reg = String(y.regime ?? "").trim().toLowerCase();
      if (
        y2 != null &&
        y10 != null &&
        sp != null &&
        (reg === "normal" || reg === "flat" || reg === "inverted")
      ) {
        patch.yield_curve = {
          yield_2yr: y2,
          yield_10yr: y10,
          spread: sp,
          regime: reg,
          label: String(y.label ?? "").trim() || `Yield curve: ${reg}`,
          chip: String(y.chip ?? "").trim() || ""
        };
      }
    }
  }
  if (lk === "sector") {
    const srs = String(match.sector_resolution_state ?? "").trim().toLowerCase();
    if (srs === "resolved" || srs === "pending_cache_refresh" || srs === "unmapped") {
      patch.sector_resolution_state = srs as SectorResolutionStateWire;
    }
    const sp = numOrNull(match.sector_persistence);
    if (sp != null) patch.sector_persistence = sp;
    const ssl = numOrNull(match.sector_sessions_leading);
    if (ssl != null) patch.sector_sessions_leading = Math.round(ssl);
    const sts = numOrNull(match.sector_total_sessions);
    if (sts != null) patch.sector_total_sessions = Math.round(sts);
    const st = String(match.sector_trending ?? "").trim();
    if (st) patch.sector_trending = st;
    const r1 = numOrNull(match.sector_rank_1d);
    if (r1 != null) patch.sector_rank_1d = r1;
    const r5 = numOrNull(match.sector_rank_5d);
    if (r5 != null) patch.sector_rank_5d = r5;
    const interp = String(match.sector_interpretation ?? "").trim();
    if (interp) patch.sector_interpretation = interp;
    if (typeof match.sector_data_available === "boolean") {
      patch.sector_data_available = match.sector_data_available;
    }
    const sds = match.sector_daily_sessions;
    if (Array.isArray(sds)) {
      const rows: SectorDailySessionWire[] = [];
      for (const item of sds) {
        if (!item || typeof item !== "object") continue;
        const r = item as Record<string, unknown>;
        const date = String(r.date ?? "").trim();
        const etf_pct = numOrNull(r.etf_pct);
        const spy_pct = numOrNull(r.spy_pct);
        const rel = numOrNull(r.relative);
        if (!date || etf_pct == null || spy_pct == null || rel == null) continue;
        rows.push({
          date,
          etf_pct,
          spy_pct,
          relative: rel,
          outperformed: r.outperformed === true,
          volume_ratio: numOrNull(r.volume_ratio) ?? 1
        });
      }
      if (rows.length) patch.sector_daily_sessions = rows;
    }
  }
  return patch;
}

export function buildEvidenceFromSetup(
  setup: IntradaySetupPayload,
  snapshot?: SnapshotPayload,
  options?: BuildEvidenceOptions
): SignalEvidenceData {
  const symbolUpper = setup.symbol.trim().toUpperCase();
  const articles = options?.symbolNewsArticles ?? [];
  const first = articles[0];
  const articleCount = articles.length;
  const newsSnippet = firstNewsSnippetForEvidence(articles);
  const sentimentScore = first?.sentiment_score;
  const hasNumericSentiment = typeof sentimentScore === "number" && Number.isFinite(sentimentScore);
  const newsPublishedAt = firstArticlePublishedAt(articles);

  const snap = coerceSnapshotForReferenceLevels(snapshot ?? null);

  const direction = evidenceDirectionFromSetup(setup.direction);
  const directionBadgeLabel = directionBadgeFromSetup(setup.direction);
  const confidencePercent = clamp(
    typeof setup.confluence_score === "number" && Number.isFinite(setup.confluence_score)
      ? Math.round(setup.confluence_score)
      : Math.round(setup.score * 100),
    0,
    100
  );
  const last = snap?.last_trade_price ?? null;
  const dayVwap = snap?.day_vwap;
  const prev = snap?.prev_close ?? last;
  const momentum = typeof last === "number" && typeof prev === "number" && prev > 0 ? ((last - prev) / prev) * 100 : 0;
  const base = clamp(50 + momentum * 6, 0, 100);

  const technical = clamp(base + 18, 0, 100);
  const newsDelta = hasNumericSentiment ? sentimentScore * 12 : newsSnippet ? 10 : -8;
  const news = clamp(base + newsDelta, 0, 100);
  const macro = clamp(base - 6, 0, 100);
  const sector = clamp(base + 4, 0, 100);
  const geopolitical = clamp(base - 11, 0, 100);
  const internals = clamp(base + 8, 0, 100);

  const techPoints = keyPointsTechnicalFromSnapshot(snap, technical, symbolUpper);

  const layers: EvidenceLayer[] = [
    {
      key: "technical",
      icon: "📊",
      name: "Technical",
      status: statusFromScore(technical),
      weightPercent: 30,
      explanation: "Price action and trend structure are evaluated against intraday momentum.",
      keyPoints: techPoints,
      contributionScore: technical,
      freshnessLabel: layerFreshnessFromIso(setup.timestamp_iso)
    },
    {
      key: "news",
      icon: "📰",
      name: "News Sentiment",
      status: statusFromScore(news),
      weightPercent: 18,
      explanation: "Headline sentiment and catalyst intensity shape short-term directional bias.",
      keyPoints: [
        `Articles ${articleCount}`,
        hasNumericSentiment
          ? `Sentiment score ${sentimentScore >= 0 ? "+" : ""}${sentimentScore.toFixed(2)}`
          : "Sentiment score n/a",
        newsSnippet ??
          (articleCount > 0 ? `${articleCount} recent articles` : `No recent news for ${symbolUpper}`)
      ],
      contributionScore: news,
      freshnessLabel:
        articleCount > 0 ? `News ${relativeNewsTime(newsPublishedAt)}` : `No recent news for ${symbolUpper}`
    },
    {
      key: "macro",
      icon: "🌍",
      name: "Macro",
      status: statusFromScore(macro),
      weightPercent: 14,
      explanation: "Rates and macro event pressure influence signal alignment and risk appetite.",
      keyPoints: keyPointsMacroFallback(macro),
      contributionScore: macro,
      freshnessLabel: "Updated 30m ago"
    },
    {
      key: "sector",
      icon: "🏭",
      name: "Sector",
      status: statusFromScore(sector),
      weightPercent: 14,
      explanation: "Relative sector leadership versus SPX confirms or weakens setup quality.",
      keyPoints: keyPointsSectorFallback(sector, symbolUpper),
      contributionScore: sector,
      freshnessLabel: "Updated 10m ago"
    },
    {
      key: "geopolitical",
      icon: "🌐",
      name: "Geopolitical",
      status: statusFromScore(geopolitical),
      weightPercent: 10,
      explanation: "External risk events are monitored to discount fragile long/short signals.",
      keyPoints: keyPointsGeoFallback(geopolitical),
      contributionScore: geopolitical,
      freshnessLabel: "Updated 1h ago"
    },
    {
      key: "internals",
      icon: "📈",
      name: "Internals",
      status: statusFromScore(internals),
      weightPercent: 14,
      explanation: "Breadth, VIX trend, and A/D line provide market participation confirmation.",
      keyPoints: keyPointsInternalsFallback(internals),
      contributionScore: internals,
      freshnessLabel: "Updated 5m ago"
    }
  ];

  const support = snap?.day_low ?? (typeof last === "number" ? last * 0.985 : null);
  const resistance = snap?.day_high ?? (typeof last === "number" ? last * 1.015 : null);
  const vwapLevel =
    typeof dayVwap === "number" && Number.isFinite(dayVwap)
      ? dayVwap
      : typeof last === "number"
        ? last * 0.997
        : null;

  const confluence =
    typeof setup.confluence_score === "number" && Number.isFinite(setup.confluence_score)
      ? {
          confluence_score: Math.round(setup.confluence_score),
          confluence_tier: String(setup.confluence_tier ?? "weak"),
          is_confluence_alert: Boolean(setup.is_confluence_alert),
          confirming_signals: (setup.confirming_signals ?? []).map((c) => ({
            label: String(c.label ?? ""),
            detail: c.detail ? String(c.detail) : undefined
          })),
          conflicting_signals: (setup.conflicting_signals ?? []).map((c) => ({
            label: String(c.label ?? ""),
            detail: c.detail ? String(c.detail) : undefined
          })),
          n_confirming: typeof setup.n_confirming === "number" ? setup.n_confirming : 0,
          n_conflicting: typeof setup.n_conflicting === "number" ? setup.n_conflicting : 0,
          historical_note: String(setup.historical_note ?? ""),
          confluence_disclaimer: String(setup.confluence_disclaimer ?? "")
        }
      : null;

  const prevCloseRaw = snap?.prev_close;
  const prevClose =
    typeof prevCloseRaw === "number" && Number.isFinite(prevCloseRaw) && prevCloseRaw > 0 ? prevCloseRaw : null;

  return {
    symbol: setup.symbol,
    direction,
    directionBadgeLabel,
    confidencePercent,
    layers,
    confluence,
    lastTradePrice: typeof last === "number" && Number.isFinite(last) && last > 0 ? last : null,
    prevClose,
    aiVerdict:
      direction === "bullish"
        ? "Strong technical pattern with supportive internals; geopolitical noise is the main risk to continuation."
        : direction === "bearish"
          ? "Momentum and risk signals lean defensive; macro crosscurrents limit reversal signal strength."
          : "Signal layers are mixed, so signal strength remains moderate until stronger alignment appears.",
    aiFreshnessLabel: "Updated 30s ago",
    keyLevels: {
      vwap: vwapLevel,
      support,
      resistance,
      orHigh: typeof resistance === "number" ? resistance * 1.003 : null,
      orLow: typeof support === "number" ? support * 0.997 : null
    },
    updatedLabel: timeAgoLabelFromIso(setup.timestamp_iso),
    updatedAtIso: setup.timestamp_iso,
    newsFreshnessLabel:
      articleCount > 0 ? `News ${relativeNewsTime(newsPublishedAt)}` : `No recent news for ${symbolUpper}`,
    earningsRisk:
      typeof options?.earningsRiskDays === "number" && options.earningsRiskDays >= 0 && options.earningsRiskDays <= 3
        ? {
            daysUntil: options.earningsRiskDays,
            reportTime: options.earningsReportTime || "unknown"
          }
        : null
  };
}

function mapConfluenceChipList(raw: unknown): Array<{ label: string; detail?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((c) => ({
      label: String(c.label ?? c.name ?? "").trim(),
      detail: c.detail != null ? String(c.detail).trim() : undefined
    }))
    .filter((c) => c.label.length > 0);
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const ALIGN_LEVEL_SET = new Set<string>(["full", "strong", "moderate", "weak", "conflict"]);

/** Parse composite top-level ``alignment`` object (additive API field). */
export function parseCompositeAlignment(raw: unknown): CompositeAlignmentWire | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const levelRaw = String(o.level ?? "").trim().toLowerCase();
  if (!ALIGN_LEVEL_SET.has(levelRaw)) return null;
  const mod = numOrNull(o.score_modifier);
  if (mod == null) return null;
  const label = String(o.label ?? "").trim();
  const detail = String(o.detail ?? "").trim();
  const chip = String(o.chip ?? "").trim();
  if (!label || !detail || !chip) return null;
  return {
    level: levelRaw as CompositeAlignmentLevelWire,
    score_modifier: Math.round(mod * 10) / 10,
    label,
    detail,
    chip,
    is_tailwind: o.is_tailwind === true,
    is_headwind: o.is_headwind === true,
    is_counter_trend: o.is_counter_trend === true,
    macro_direction: String(o.macro_direction ?? "neutral").trim().toLowerCase(),
    sector_direction: String(o.sector_direction ?? "neutral").trim().toLowerCase(),
    technical_direction: String(o.technical_direction ?? "neutral").trim().toLowerCase(),
    macro_supports: o.macro_supports === true,
    sector_supports: o.sector_supports === true,
    technical_supports: o.technical_supports === true
  };
}

function parseGeoEventDetailRows(raw: unknown): GeoEventDetailRow[] {
  if (!Array.isArray(raw)) return [];
  const out: GeoEventDetailRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const et = String(o.event_type ?? "").trim();
    const sc = numOrNull(o.score);
    if (!et || sc == null) continue;
    const mult =
      o.sector_multiplier === null || o.sector_multiplier === undefined ? null : numOrNull(o.sector_multiplier);
    out.push({ event_type: et, score: sc, sector_multiplier: mult });
  }
  return out;
}

function formatGeoSectorLabel(key: string): string {
  const k = (key || "").trim();
  if (!k || k === "default") return "Sector unknown";
  return k.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function structuralBandFromBaselineScore(score: number | null): "low" | "moderate" | "high" | null {
  if (score == null) return null;
  if (score >= 60) return "high";
  if (score >= 35) return "moderate";
  return "low";
}

/** Parse composite `layers[]` row for geopolitical into card extras. */
export function extractGeopoliticalLayerExtras(match: Record<string, unknown>): GeopoliticalLayerExtras | undefined {
  const ik = String(match.geo_impact_sector_key ?? "").trim();
  const details = parseGeoEventDetailRows(match.geo_event_details);
  const summaryRaw = match.geo_exposure_summary;
  const exposureSummary = typeof summaryRaw === "string" && summaryRaw.trim() ? summaryRaw.trim() : null;
  const stockExposureScore = numOrNull(match.geo_stock_exposure_score);
  const bandRaw = String(match.geo_exposure_band ?? "").trim().toLowerCase();
  const exposureBand =
    bandRaw === "low" || bandRaw === "moderate" || bandRaw === "high" ? (bandRaw as "low" | "moderate" | "high") : null;
  const geoBaselineScore = numOrNull(match.geo_baseline_score);
  const blRaw = match.geo_baseline_summary;
  const geoBaselineSummary = typeof blRaw === "string" && blRaw.trim() ? blRaw.trim() : null;
  const geoPrimaryClean =
    match.geo_primary_theme == null ? null : String(match.geo_primary_theme).trim() || null;

  const activeEvents: Array<{ event_type: string; score: number }> = [];
  const rawEv = match.geo_active_events;
  if (Array.isArray(rawEv)) {
    for (const e of rawEv) {
      if (!e || typeof e !== "object") continue;
      const o = e as Record<string, unknown>;
      const et = String(o.event_type ?? "").trim();
      const sc = numOrNull(o.score);
      if (et && sc != null) activeEvents.push({ event_type: et, score: sc });
    }
  }
  const liveFlagRaw = match.geo_has_live_events;
  const geoHasLiveEvents =
    typeof liveFlagRaw === "boolean" ? Boolean(liveFlagRaw) : activeEvents.length > 0;
  const eventDetails: GeoEventDetailRow[] =
    details.length > 0
      ? details
      : activeEvents.map((e) => ({ event_type: e.event_type, score: e.score, sector_multiplier: null }));
  const baselineBand = structuralBandFromBaselineScore(geoBaselineScore);
  const hasSomething =
    ik.length > 0 ||
    exposureSummary != null ||
    stockExposureScore != null ||
    activeEvents.length > 0 ||
    eventDetails.length > 0 ||
    exposureBand != null ||
    geoBaselineSummary != null ||
    geoBaselineScore != null ||
    geoHasLiveEvents ||
    geoPrimaryClean != null;
  if (!hasSomething) return undefined;

  const exposureBandMerged = geoHasLiveEvents ? exposureBand : baselineBand ?? exposureBand;

  return {
    impactSectorKey: ik,
    impactSectorLabel: formatGeoSectorLabel(ik || "default"),
    stockExposureScore,
    exposureBand: exposureBandMerged ?? baselineBand ?? exposureBand,
    exposureSummary: exposureSummary ?? geoBaselineSummary,
    activeEvents,
    eventDetails,
    geoBaselineScore: geoBaselineScore ?? undefined,
    geoBaselineSummary: geoBaselineSummary ?? undefined,
    geoHasLiveEvents,
    geoPrimaryTheme: geoPrimaryClean
  };
}

/** Map composite JSON to 0–100 for insight; supports `signal_score`, `signal_strength` (0–1), or `score` (−1..1). */
function compositeSignalScoreFromBody(body: Record<string, unknown>): number | null {
  const explicit = numOrNull(body.signal_score);
  if (explicit != null) {
    return clamp(Math.round(explicit), 0, 100);
  }
  const strength = numOrNull(body.signal_strength);
  if (strength != null) {
    return clamp(Math.round(strength * 100), 0, 100);
  }
  const sc = numOrNull(body.score);
  if (sc != null) {
    return clamp(Math.round(((sc + 1) / 2) * 100), 0, 100);
  }
  return null;
}

function parseHistoricalZone(raw: unknown): { low: number; high: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const low = numOrNull(o.low);
  const high = numOrNull(o.high);
  if (low == null || high == null || !(high > low)) return null;
  return { low, high };
}

type ParsedCatalystRow = {
  text: string;
  sentiment: string;
  source?: string;
  published_at?: string;
  sentiment_score?: number;
};

function parseOneCatalystObject(o: Record<string, unknown>): ParsedCatalystRow | null {
  const text = String(o.text ?? o.title ?? "").trim();
  if (!text) return null;
  const ss = numOrNull(o.sentiment_score);
  const sent = String(o.sentiment ?? (ss != null ? (ss > 0 ? "positive" : ss < 0 ? "negative" : "neutral") : "neutral")).toLowerCase();
  const sentiment = sent === "positive" || sent === "negative" || sent === "neutral" ? sent : "neutral";
  const source = String(o.source ?? "").trim() || undefined;
  const publishedRaw = o.published_at ?? o.published_utc;
  const published_at = publishedRaw != null && String(publishedRaw).trim() !== "" ? String(publishedRaw).trim() : undefined;
  return {
    text: text.slice(0, 240),
    sentiment,
    source,
    published_at,
    sentiment_score: ss ?? undefined
  };
}

function parseCatalystArray(raw: unknown, maxScan: number): ParsedCatalystRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedCatalystRow[] = [];
  for (const c of raw.slice(0, maxScan)) {
    if (c && typeof c === "object") {
      const p = parseOneCatalystObject(c as Record<string, unknown>);
      if (p) out.push(p);
    } else if (typeof c === "string" && c.trim()) {
      out.push({ text: c.trim().slice(0, 240), sentiment: "neutral" });
    }
  }
  return out;
}

function catalystDedupeKey(text: string): string {
  return text.trim().toLowerCase().slice(0, 160);
}

function mergeCatalystRowParsed(a: ParsedCatalystRow, b: ParsedCatalystRow): ParsedCatalystRow {
  const sentiment = b.sentiment !== "neutral" ? b.sentiment : a.sentiment;
  const scoreA = a.sentiment_score;
  const scoreB = b.sentiment_score;
  return {
    text: a.text || b.text,
    sentiment,
    source: a.source || b.source,
    published_at: a.published_at || b.published_at,
    sentiment_score: scoreA != null ? scoreA : scoreB
  };
}

function mergeCatalystListsParsed(primary: ParsedCatalystRow[], secondary: ParsedCatalystRow[], limit: number): ParsedCatalystRow[] {
  const map = new Map<string, ParsedCatalystRow>();
  const keys: string[] = [];
  const add = (row: ParsedCatalystRow) => {
    const k = catalystDedupeKey(row.text);
    if (!k) return;
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...row });
      keys.push(k);
    } else {
      map.set(k, mergeCatalystRowParsed(prev, row));
    }
  };
  for (const row of primary) add(row);
  for (const row of secondary) add(row);
  return keys.slice(0, limit).map((k) => map.get(k)!);
}

function catalystsFromCompositeBody(body: Record<string, unknown>): ParsedCatalystRow[] {
  const fromHeadlines = parseCatalystArray(body.catalyst_headlines, 8);
  const fromCatalysts = parseCatalystArray(body.catalysts, 8);
  if (fromHeadlines.length > 0) {
    return mergeCatalystListsParsed(fromHeadlines, fromCatalysts, 4);
  }
  return fromCatalysts.slice(0, 4);
}

/**
 * Parse swing-composite POST JSON into a structured insight. Returns null if core fields are missing.
 */
function roundPrice4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function longSideGeometry(opts: {
  dayLo: number | null;
  dayHi: number | null;
  vwap: number | null;
  prevClose: number | null;
  last: number | null;
}): { stop: number | null; target1: number | null; target2: number | null } {
  const { dayLo, dayHi, vwap, prevClose, last } = opts;
  let reference_stop: number | null = null;
  if (dayLo != null && dayLo > 0 && vwap != null && vwap > 0) {
    reference_stop = roundPrice4(Math.min(dayLo, vwap) * 0.998);
  } else if (dayLo != null && dayLo > 0) {
    reference_stop = roundPrice4(dayLo * 0.995);
  } else if (vwap != null && vwap > 0) {
    reference_stop = roundPrice4(vwap * 0.995);
  } else if (prevClose != null && prevClose > 0) {
    reference_stop = roundPrice4(prevClose * 0.99);
  } else if (last != null && last > 0) {
    reference_stop = roundPrice4(last * 0.98);
  }

  let reference_target_1: number | null = null;
  if (dayHi != null && dayHi > 0) {
    reference_target_1 = roundPrice4(dayHi);
  } else if (last != null && last > 0) {
    reference_target_1 = roundPrice4(last * 1.012);
  }

  let reference_target_2: number | null = null;
  const entryGuess = last != null && last > 0 ? last : null;
  if (reference_target_1 != null && reference_stop != null && entryGuess != null && entryGuess > reference_stop) {
    const t2R = entryGuess + 2.0 * (entryGuess - reference_stop);
    if (t2R > reference_target_1 + 1e-6) {
      reference_target_2 = roundPrice4(t2R);
    }
  }
  if (reference_target_2 == null && reference_target_1 != null && last != null && last > 0) {
    reference_target_2 = roundPrice4(reference_target_1 * 1.004);
  }
  return { stop: reference_stop, target1: reference_target_1, target2: reference_target_2 };
}

function shortSideGeometry(opts: {
  dayLo: number | null;
  dayHi: number | null;
  vwap: number | null;
  prevClose: number | null;
  last: number | null;
}): { stop: number | null; target1: number | null; target2: number | null } {
  const { dayLo, dayHi, vwap, prevClose, last } = opts;
  let reference_stop: number | null = null;
  if (dayHi != null && dayHi > 0 && vwap != null && vwap > 0) {
    reference_stop = roundPrice4(Math.max(dayHi, vwap) * 1.002);
  } else if (dayHi != null && dayHi > 0) {
    reference_stop = roundPrice4(dayHi * 1.005);
  } else if (vwap != null && vwap > 0) {
    reference_stop = roundPrice4(vwap * 1.005);
  } else if (prevClose != null && prevClose > 0) {
    reference_stop = roundPrice4(prevClose * 1.01);
  } else if (last != null && last > 0) {
    reference_stop = roundPrice4(last * 1.02);
  }

  let reference_target_1: number | null = null;
  if (dayLo != null && dayLo > 0) {
    reference_target_1 = roundPrice4(dayLo);
  } else if (last != null && last > 0) {
    reference_target_1 = roundPrice4(last * 0.988);
  }

  let reference_target_2: number | null = null;
  const entryGuess = last != null && last > 0 ? last : null;
  if (reference_target_1 != null && reference_stop != null && entryGuess != null && reference_stop > entryGuess) {
    const t2R = entryGuess - 2.0 * (reference_stop - entryGuess);
    if (t2R < reference_target_1 - 1e-6) {
      reference_target_2 = roundPrice4(t2R);
    }
  }
  if (reference_target_2 == null && reference_target_1 != null && last != null && last > 0) {
    reference_target_2 = roundPrice4(reference_target_1 * 0.996);
  }
  return { stop: reference_stop, target1: reference_target_1, target2: reference_target_2 };
}

function useLongRrStructure(
  direction: EvidenceDirection,
  dayLo: number | null,
  dayHi: number | null,
  last: number | null
): boolean {
  if (direction === "bullish") return true;
  if (direction === "bearish") return false;
  if (dayLo != null && dayHi != null && dayHi > dayLo && last != null && last > 0) {
    const mid = (dayLo + dayHi) / 2;
    return last >= mid;
  }
  return true;
}

function entryPriceForRr(last: number | null, zoneLo: number | null, zoneHi: number | null): number | null {
  if (last != null && last > 0) return last;
  if (zoneLo != null && zoneHi != null && zoneHi > zoneLo) return (zoneLo + zoneHi) / 2;
  return null;
}

function rrFromLevelsLong(entry: number, target: number, stop: number): number | null {
  const risk = entry - stop;
  const reward = target - entry;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return reward / risk;
}

function rrFromLevelsShort(entry: number, target: number, stop: number): number | null {
  const risk = stop - entry;
  const reward = entry - target;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return reward / risk;
}

function syntheticRrFromConfidence(confidencePercent: number): number {
  const conf = clamp(confidencePercent, 0, 100) / 100;
  return Math.round(Math.min(3.5, Math.max(1.0, 1.15 + conf * 1.55)) * 10) / 10;
}

function rrQualityFromValue(riskReward: number): "low" | "acceptable" | "good" | "strong" {
  if (riskReward < 2.0) return "low";
  if (riskReward < 3.0) return "acceptable";
  if (riskReward < 5.0) return "good";
  return "strong";
}

export interface SessionReferenceLevelsInput {
  direction: EvidenceDirection;
  support?: number | null;
  resistance?: number | null;
  vwap?: number | null;
  lastTradePrice?: number | null;
  prevClose?: number | null;
}

/**
 * Reference stop / targets from session structure (VWAP + session high/low), matching
 * `swing_composite_evidence._long_side_geometry` / `_short_side_geometry` — not fixed % off support/resistance alone.
 */
export function referenceLevelsFromSessionStructure(
  input: SessionReferenceLevelsInput
): {
  reference_stop_level: number | null;
  reference_target_1: number | null;
  reference_target_2: number | null;
} {
  const dayLo =
    typeof input.support === "number" && Number.isFinite(input.support) && input.support > 0 ? input.support : null;
  const dayHi =
    typeof input.resistance === "number" && Number.isFinite(input.resistance) && input.resistance > 0
      ? input.resistance
      : null;
  const vwap = typeof input.vwap === "number" && Number.isFinite(input.vwap) && input.vwap > 0 ? input.vwap : null;
  const last =
    typeof input.lastTradePrice === "number" && Number.isFinite(input.lastTradePrice) && input.lastTradePrice > 0
      ? input.lastTradePrice
      : null;
  const prevClose =
    typeof input.prevClose === "number" && Number.isFinite(input.prevClose) && input.prevClose > 0 ? input.prevClose : null;

  const useLong = useLongRrStructure(input.direction, dayLo, dayHi, last);
  const g = useLong
    ? longSideGeometry({ dayLo, dayHi, vwap, prevClose, last })
    : shortSideGeometry({ dayLo, dayHi, vwap, prevClose, last });
  return {
    reference_stop_level: g.stop,
    reference_target_1: g.target1,
    reference_target_2: g.target2
  };
}

export function parseSwingCompositeInsight(body: Record<string, unknown>): SignalEvidenceInsight | null {
  const signal_score = compositeSignalScoreFromBody(body);
  if (signal_score == null) return null;
  const trend_strength = String(body.trend_strength ?? "").trim() || "Moderate";
  const trend_direction = String(body.trend_direction ?? "").trim() || "Sideways";
  const risk_reward = numOrNull(body.risk_reward) ?? 1.5;
  const rr_warning = Boolean(body.rr_warning) || risk_reward < 2.0;
  const rr_qualityRaw = String(body.rr_quality ?? "").trim().toLowerCase();
  const rr_quality =
    rr_qualityRaw === "low" || rr_qualityRaw === "acceptable" || rr_qualityRaw === "good" || rr_qualityRaw === "strong"
      ? rr_qualityRaw
      : undefined;
  const market_regime = String(body.market_regime ?? "Neutral").trim() || "Neutral";
  const confirming_signals = mapConfluenceChipList(body.confirming_signals);
  const conflicting_signals = mapConfluenceChipList(body.conflicting_signals);
  const catalysts = catalystsFromCompositeBody(body);
  const riskRaw = body.risk_factors;
  const riskDetailedRaw = body.risk_factors_detailed;
  const risk_factors_detailed: Array<{ label: string; severity: "high" | "medium" | "low"; detail: string }> = [];
  if (Array.isArray(riskDetailedRaw)) {
    for (const item of riskDetailedRaw.slice(0, 6)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const label = String(row.label ?? "").trim();
      const detail = String(row.detail ?? "").trim();
      const sev = String(row.severity ?? "").trim().toLowerCase();
      if (!label || !detail) continue;
      if (sev !== "high" && sev !== "medium" && sev !== "low") continue;
      risk_factors_detailed.push({ label, severity: sev, detail });
    }
  }
  const risk_factors: string[] = [];
  if (Array.isArray(riskRaw)) {
    for (const r of riskRaw.slice(0, 4)) {
      if (typeof r === "string" && r.trim()) risk_factors.push(r.trim());
    }
  }
  const signal_parameters =
    typeof body.signal_parameters === "string" && body.signal_parameters.trim()
      ? body.signal_parameters.trim()
      : "Observe how price behaves versus the Historical Entry Zone on a closing basis. Signal data only — not investment advice.";
  const historical_entry_zone = parseHistoricalZone(body.historical_entry_zone);
  const vwapRaw = numOrNull(body.vwap ?? body.day_vwap);
  const vwap_state_parsed = String(body.vwap_state ?? "").trim() || undefined;
  const vwap_display_parsed = String(body.vwap_display ?? "").trim() || undefined;
  const vwap_tooltip_parsed = String(body.vwap_tooltip ?? "").trim() || undefined;
  return {
    signal_score,
    trend_strength,
    trend_direction,
    risk_reward: Math.round(risk_reward * 10) / 10,
    rr_warning,
    rr_quality,
    market_regime,
    confirming_signals,
    conflicting_signals,
    catalysts,
    risk_factors,
    risk_factors_detailed,
    signal_parameters,
    historical_entry_zone,
    reference_target_1: numOrNull(body.reference_target_1),
    reference_target_2: numOrNull(body.reference_target_2),
    reference_stop_level: numOrNull(body.reference_stop_level),
    vwap: vwapRaw != null && vwapRaw > 0 ? Math.round(vwapRaw * 10000) / 10000 : null,
    vwap_state: vwap_state_parsed,
    vwap_display: vwap_display_parsed,
    vwap_tooltip: vwap_tooltip_parsed,
    is_complete: body.is_complete === false ? false : true,
    missing_fields: Array.isArray(body.missing_fields) ? body.missing_fields.map((x) => String(x)) : [],
    alignment_ratio: numOrNull(body.alignment_ratio) ?? undefined,
    conflicted_layers: Array.isArray(body.conflicted_layers) ? body.conflicted_layers.map((x) => String(x)) : []
  };
}

export function deriveEvidenceInsightFallback(evidence: SignalEvidenceData): SignalEvidenceInsight {
  const signal_score = clamp(evidence.confidencePercent, 0, 100);
  const trend_strength = signal_score >= 72 ? "Strong" : signal_score >= 48 ? "Moderate" : "Weak";
  const trend_direction =
    evidence.direction === "bullish" ? "Uptrend" : evidence.direction === "bearish" ? "Downtrend" : "Sideways";
  const { support, resistance, vwap } = evidence.keyLevels;
  const last =
    typeof evidence.lastTradePrice === "number" && Number.isFinite(evidence.lastTradePrice) && evidence.lastTradePrice > 0
      ? evidence.lastTradePrice
      : null;
  const prevClose =
    typeof evidence.prevClose === "number" && Number.isFinite(evidence.prevClose) && evidence.prevClose > 0
      ? evidence.prevClose
      : null;

  const historical_entry_zone =
    typeof support === "number" && typeof resistance === "number" && resistance > support
      ? { low: Math.round(support * 10000) / 10000, high: Math.round(resistance * 10000) / 10000 }
      : typeof vwap === "number" && vwap > 0
        ? { low: Math.round(vwap * 0.99 * 10000) / 10000, high: Math.round(vwap * 1.01 * 10000) / 10000 }
        : null;

  const { reference_stop_level, reference_target_1, reference_target_2 } = referenceLevelsFromSessionStructure({
    direction: evidence.direction,
    support,
    resistance,
    vwap,
    lastTradePrice: last ?? undefined,
    prevClose: prevClose ?? undefined
  });

  const zoneLo = historical_entry_zone?.low ?? null;
  const zoneHi = historical_entry_zone?.high ?? null;
  const dayLo = typeof support === "number" && Number.isFinite(support) && support > 0 ? support : null;
  const dayHi = typeof resistance === "number" && Number.isFinite(resistance) && resistance > 0 ? resistance : null;
  const entry = entryPriceForRr(last, zoneLo, zoneHi);
  const useLong = useLongRrStructure(evidence.direction, dayLo, dayHi, last);
  let rrFromStructure: number | null = null;
  if (
    entry != null &&
    reference_stop_level != null &&
    reference_target_1 != null &&
    Number.isFinite(entry) &&
    Number.isFinite(reference_stop_level) &&
    Number.isFinite(reference_target_1)
  ) {
    rrFromStructure = useLong
      ? rrFromLevelsLong(entry, reference_target_1, reference_stop_level)
      : rrFromLevelsShort(entry, reference_target_1, reference_stop_level);
  }
  const risk_reward =
    rrFromStructure != null
      ? Math.round(Math.min(10.0, Math.max(0.5, rrFromStructure)) * 10) / 10
      : syntheticRrFromConfidence(evidence.confidencePercent);
  const rr_warning = risk_reward < 2.0;
  const rr_quality = rrQualityFromValue(risk_reward);

  const macroLayer = evidence.layers.find((l) => l.key === "macro");
  const market_regime =
    macroLayer?.status === "Bullish" ? "Bullish" : macroLayer?.status === "Bearish" ? "Bearish" : "Neutral";
  const confirming_signals = evidence.confluence?.confirming_signals ?? [];
  const conflicting_signals = evidence.confluence?.conflicting_signals ?? [];
  const newsLayer = evidence.layers.find((l) => l.key === "news");
  const catalysts: Array<{ text: string; sentiment: string }> = [];
  const kp = newsLayer?.keyPoints?.[2];
  if (kp && !kp.startsWith("No recent")) {
    const sentiment =
      newsLayer.status === "Bearish" ? "negative" : newsLayer.status === "Bullish" ? "positive" : "neutral";
    catalysts.push({ text: kp.slice(0, 240), sentiment });
  }
  const risk_factors: string[] = [];
  for (const c of conflicting_signals.slice(0, 4)) {
    if (c.label) risk_factors.push(c.label);
  }
  if (risk_factors.length < 3) {
    risk_factors.push("Layer scores reflect submitted snapshots; confirm live prices and liquidity before acting.");
  }
  if (risk_factors.length < 4 && evidence.direction === "neutral") {
    risk_factors.push("Neutral read: layers disagree — treat follow-through as unconfirmed.");
  }
  const sym = evidence.symbol.trim().toUpperCase() || "SYMBOL";
  const zoneTxt = historical_entry_zone
    ? `$${historical_entry_zone.low.toFixed(2)}–$${historical_entry_zone.high.toFixed(2)}`
    : "the Historical Entry Zone in the reference strip";
  const vwTxt = typeof vwap === "number" && vwap > 0 ? `$${vwap.toFixed(2)}` : "VWAP in the reference strip";
  const signal_parameters = `Consider observing how ${sym} behaves versus ${zoneTxt} on a closing basis before sizing any follow-up. Scale participation down when confirming layers diverge or when price cannot hold ${vwTxt}. Invalidate the constructive read on a decisive close back through the lower bound of the Historical Entry Zone for this horizon. Signal data only — not investment advice.`;
  const vwapLvl =
    typeof evidence.keyLevels.vwap === "number" && Number.isFinite(evidence.keyLevels.vwap) && evidence.keyLevels.vwap > 0
      ? Math.round(evidence.keyLevels.vwap * 10000) / 10000
      : null;
  const vwapFb = getVWAPDisplay(
    vwapLvl,
    vwapLvl != null && vwapLvl > 0 ? VWAP_STATE.AVAILABLE : undefined,
    last,
    evidence.keyLevels.vwap_display,
    evidence.keyLevels.vwap_tooltip
  );
  return {
    signal_score,
    trend_strength,
    trend_direction,
    risk_reward,
    rr_warning,
    rr_quality,
    market_regime,
    confirming_signals,
    conflicting_signals,
    catalysts: catalysts.slice(0, 4),
    risk_factors: risk_factors.slice(0, 4),
    signal_parameters,
    historical_entry_zone,
    reference_target_1,
    reference_target_2,
    reference_stop_level,
    vwap: vwapLvl,
    vwap_state: vwapFb.state,
    vwap_display: vwapFb.label,
    vwap_tooltip: vwapFb.tooltip
  };
}

/** Strip legacy ORB runtime labels; map slug chips to session copy. */
export const ORB_CHIP_REMAP: Record<string, string> = {
  "ORB Expired": "",
  "ORB Unavailable": "",
  orb_breakout_long: "ORB Long ↑",
  orb_breakout_short: "ORB Short ↓",
  orb_forming: "ORB Forming"
};

export function sanitizeEvidenceChips(rawChips: string[]): string[] {
  const out: string[] = [];
  for (const raw of rawChips) {
    const chip = String(raw).trim();
    if (!chip) continue;
    const lower = chip.toLowerCase();
    if (lower.includes("expired")) continue;
    if (lower.startsWith("orb") && lower.includes("unavailable")) continue;
    const mapped = ORB_CHIP_REMAP[chip] ?? ORB_CHIP_REMAP[chip.trim()];
    const next = (mapped !== undefined ? mapped : chip).trim();
    if (!next) continue;
    out.push(next);
  }
  return out;
}

function findContributionRow(body: Record<string, unknown>, layerKey: string): Record<string, unknown> | undefined {
  const raw = body.contributions;
  if (!Array.isArray(raw)) return undefined;
  return (raw as Array<Record<string, unknown>>).find((c) => String(c.layer ?? "").toLowerCase() === layerKey);
}

function mergeParsedInsightWithFallback(
  parsed: SignalEvidenceInsight,
  fallback: SignalEvidenceInsight
): SignalEvidenceInsight {
  const catalysts = parsed.catalysts.length > 0 ? parsed.catalysts : fallback.catalysts;
  const risk_factors = parsed.risk_factors.length > 0 ? parsed.risk_factors : fallback.risk_factors;
  const risk_factors_detailed =
    parsed.risk_factors_detailed && parsed.risk_factors_detailed.length > 0
      ? parsed.risk_factors_detailed
      : fallback.risk_factors_detailed;
  return {
    ...fallback,
    ...parsed,
    historical_entry_zone: parsed.historical_entry_zone ?? fallback.historical_entry_zone,
    reference_target_1: parsed.reference_target_1 ?? fallback.reference_target_1,
    reference_target_2: parsed.reference_target_2 ?? fallback.reference_target_2,
    reference_stop_level: parsed.reference_stop_level ?? fallback.reference_stop_level,
    vwap: parsed.vwap ?? fallback.vwap,
    vwap_state: parsed.vwap_state ?? fallback.vwap_state,
    vwap_display: parsed.vwap_display ?? fallback.vwap_display,
    vwap_tooltip: parsed.vwap_tooltip ?? fallback.vwap_tooltip,
    catalysts,
    risk_factors,
    risk_factors_detailed
  };
}

export function applySwingCompositeEnrichment(
  evidence: SignalEvidenceData,
  body: Record<string, unknown> | null | undefined
): SignalEvidenceData {
  const fallback = deriveEvidenceInsightFallback(evidence);
  const cm: "day" | "swing" | undefined =
    body != null && (body.mode === "swing" || body.mode === "day")
      ? (body.mode as "day" | "swing")
      : evidence.compositeMode;
  if (body == null || body.status === "insufficient_data") {
    const signal_basis_i = body != null && typeof body.signal_basis === "string" ? body.signal_basis : evidence.signal_basis;
    const signal_basis_label_i =
      body != null && typeof body.signal_basis_label === "string" ? body.signal_basis_label : evidence.signal_basis_label;
    return {
      ...evidence,
      insight: fallback,
      compositeMode: cm ?? evidence.compositeMode,
      signal_basis: signal_basis_i,
      signal_basis_label: signal_basis_label_i,
      alignment: evidence.alignment ?? null
    };
  }
  const parsed = parseSwingCompositeInsight(body);
  const insight = parsed == null ? fallback : mergeParsedInsightWithFallback(parsed, fallback);
  let confluence = evidence.confluence;
  const cs = body.confluence_score;
  if (typeof cs === "number" && Number.isFinite(cs)) {
    confluence = {
      confluence_score: Math.round(cs),
      confluence_tier: String(body.confluence_tier ?? "weak"),
      is_confluence_alert: Boolean(body.is_confluence_alert),
      confirming_signals: mapConfluenceChipList(body.confirming_signals),
      conflicting_signals: mapConfluenceChipList(body.conflicting_signals),
      n_confirming: typeof body.n_confirming === "number" ? body.n_confirming : mapConfluenceChipList(body.confirming_signals).length,
      n_conflicting:
        typeof body.n_conflicting === "number" ? body.n_conflicting : mapConfluenceChipList(body.conflicting_signals).length,
      historical_note: String(body.historical_note ?? ""),
      confluence_disclaimer: String(body.confluence_disclaimer ?? "")
    };
  }

  const rawLayers = body.layers;
  let layers = evidence.layers;
  if (Array.isArray(rawLayers)) {
    layers = evidence.layers.map((layer) => {
      const match = (rawLayers as Array<Record<string, unknown>>).find(
        (x) => String(x.layer ?? "").toLowerCase() === layer.key
      );
      if (!match) {
        const contribOnly = findContributionRow(body, layer.key);
        const cr = typeof contribOnly?.reasoning === "string" ? contribOnly.reasoning.trim() : "";
        if (cr) {
          const parts = reasoningToKeyPoints(cr, 4);
          if (parts.length) return { ...layer, keyPoints: parts };
        }
        return layer;
      }
      const apiLayer = evidencePatchFromApiLayer(match, layer.key);
      const geo = layer.key === "geopolitical" ? extractGeopoliticalLayerExtras(match) : undefined;
      const maxChips = layer.key === "geopolitical" ? 6 : 4;
      const fin = (merged: EvidenceLayer): EvidenceLayer => (geo ? { ...merged, geo } : merged);
      const chips = match.chips;
      if (Array.isArray(chips) && chips.length > 0) {
        let raw = chips.map((c) => String(c));
        if (layer.key === "technical" && cm === "swing") {
          raw = filterChipsForMode(raw, "swing");
        }
        return fin({
          ...layer,
          ...apiLayer,
          keyPoints: sanitizeEvidenceChips(raw).slice(0, maxChips)
        });
      }
      const reasoning = typeof match.reasoning === "string" ? match.reasoning.trim() : "";
      if (reasoning) {
        const parts = reasoningToKeyPoints(reasoning, maxChips);
        if (parts.length) {
          return fin({ ...layer, ...apiLayer, keyPoints: parts });
        }
      }
      const contrib = findContributionRow(body, layer.key);
      const contribR = typeof contrib?.reasoning === "string" ? contrib.reasoning.trim() : "";
      if (contribR) {
        const parts = reasoningToKeyPoints(contribR, maxChips);
        if (parts.length) return fin({ ...layer, ...apiLayer, keyPoints: parts });
      }
      const synth = synthKeyPointsFromLayerApi(match);
      if (synth.length) {
        return fin({ ...layer, ...apiLayer, keyPoints: synth });
      }
      return fin({ ...layer, ...apiLayer });
    });
  }

  const vs = typeof body.vwap_state === "string" ? body.vwap_state.trim() : "";
  const vd = typeof body.vwap_display === "string" ? body.vwap_display.trim() : "";
  const vt = typeof body.vwap_tooltip === "string" ? body.vwap_tooltip.trim() : "";
  const vwNum = numOrNull(body.vwap ?? body.day_vwap);
  const keyLevels = { ...evidence.keyLevels };
  if (vs) keyLevels.vwap_state = vs;
  if (vd) keyLevels.vwap_display = vd;
  if (vt) keyLevels.vwap_tooltip = vt;
  if (vwNum != null && vwNum > 0) keyLevels.vwap = Math.round(vwNum * 10000) / 10000;

  const signal_basis = typeof body.signal_basis === "string" ? body.signal_basis : evidence.signal_basis;
  const signal_basis_label =
    typeof body.signal_basis_label === "string" ? body.signal_basis_label : evidence.signal_basis_label;

  const alignmentMerged = parseCompositeAlignment(body.alignment) ?? evidence.alignment ?? null;

  return {
    ...evidence,
    compositeMode: cm ?? evidence.compositeMode,
    signal_basis,
    signal_basis_label,
    keyLevels,
    layers,
    insight,
    confluence,
    alignment: alignmentMerged
  };
}

/**
 * Merges real-composite API layer chips / reasoning into evidence (same-origin BFF).
 * Use from dashboard or scanner after `buildEvidenceFromSetup` so the modal matches the Signals page.
 */
export async function enrichEvidenceWithRealComposite(evidence: SignalEvidenceData): Promise<SignalEvidenceData> {
  const sym = evidence.symbol.trim().toUpperCase();
  if (!sym) return evidence;
  try {
    const res = await fetch("/api/stocvest/signals/composite/real", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ symbol: sym })
    });
    if (!res.ok) {
      return { ...evidence, insight: evidence.insight ?? deriveEvidenceInsightFallback(evidence) };
    }
    const j = (await res.json()) as Record<string, unknown>;
    return applySwingCompositeEnrichment(evidence, j);
  } catch {
    return { ...evidence, insight: evidence.insight ?? deriveEvidenceInsightFallback(evidence) };
  }
}
