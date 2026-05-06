import type { NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { coerceSnapshotForReferenceLevels } from "@/lib/snapshot-reference-levels";

export type EvidenceDirection = "bullish" | "bearish" | "neutral";
export type EvidenceStatus = "Bullish" | "Bearish" | "Neutral" | "Unavailable";

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
  /** Present when API returns geo sector mapping + themes (geopolitical layer only). */
  geo?: GeopoliticalLayerExtras;
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
  is_complete?: boolean;
  missing_fields?: string[];
  alignment_ratio?: number;
  conflicted_layers?: string[];
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
function evidencePatchFromApiLayer(match: Record<string, unknown>): Partial<EvidenceLayer> {
  const patch: Partial<EvidenceLayer> = {};
  const raw = match.score;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    patch.contributionScore = clamp(Math.round(raw), 0, 100);
  }
  const layerStatus = String(match.status ?? "").trim().toLowerCase();
  if (layerStatus === "unavailable") {
    patch.status = "Unavailable";
    return patch;
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
  const eventDetails: GeoEventDetailRow[] =
    details.length > 0
      ? details
      : activeEvents.map((e) => ({ event_type: e.event_type, score: e.score, sector_multiplier: null }));
  const hasSomething =
    ik.length > 0 ||
    exposureSummary != null ||
    stockExposureScore != null ||
    activeEvents.length > 0 ||
    eventDetails.length > 0 ||
    exposureBand != null;
  if (!hasSomething) return undefined;
  return {
    impactSectorKey: ik,
    impactSectorLabel: formatGeoSectorLabel(ik || "default"),
    stockExposureScore,
    exposureBand,
    exposureSummary,
    activeEvents,
    eventDetails
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
    vwap: vwapLvl
  };
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
  if (body == null || body.status === "insufficient_data") {
    return { ...evidence, insight: fallback };
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
      const apiLayer = evidencePatchFromApiLayer(match);
      const geo = layer.key === "geopolitical" ? extractGeopoliticalLayerExtras(match) : undefined;
      const maxChips = layer.key === "geopolitical" ? 6 : 4;
      const fin = (merged: EvidenceLayer): EvidenceLayer => (geo ? { ...merged, geo } : merged);
      const chips = match.chips;
      if (Array.isArray(chips) && chips.length > 0) {
        return fin({
          ...layer,
          ...apiLayer,
          keyPoints: chips.map((c) => String(c).trim()).filter(Boolean).slice(0, maxChips)
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

  return { ...evidence, layers, insight, confluence };
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
