import type { NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { coerceSnapshotForReferenceLevels } from "@/lib/snapshot-reference-levels";

export type EvidenceDirection = "bullish" | "bearish" | "neutral";
export type EvidenceStatus = "Bullish" | "Bearish" | "Neutral" | "Unavailable";

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
  market_regime: string;
  confirming_signals: Array<{ label: string; detail?: string }>;
  conflicting_signals: Array<{ label: string; detail?: string }>;
  catalysts: Array<{ text: string; sentiment: string }>;
  risk_factors: string[];
  signal_parameters: string;
  historical_entry_zone: { low: number; high: number } | null;
  reference_target_1: number | null;
  reference_target_2: number | null;
  reference_stop_level: number | null;
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

export interface BuildEvidenceOptions {
  symbolNewsArticles?: NewsPayload[];
  earningsRiskDays?: number;
  earningsReportTime?: "before_market" | "after_market" | "during_market" | "unknown";
}

export function buildEvidenceFromSetup(
  setup: IntradaySetupPayload,
  snapshot?: SnapshotPayload,
  options?: BuildEvidenceOptions
): SignalEvidenceData {
  const symbolUpper = setup.symbol.trim().toUpperCase();
  const articles = options?.symbolNewsArticles ?? [];
  const first = articles[0];
  const headline = first?.title?.trim() || undefined;
  const articleCount = articles.length;
  const sentimentScore = first?.sentiment_score;
  const hasNumericSentiment = typeof sentimentScore === "number" && Number.isFinite(sentimentScore);

  const snap = coerceSnapshotForReferenceLevels(snapshot ?? null);

  const direction = evidenceDirectionFromSetup(setup.direction);
  const directionBadgeLabel = directionBadgeFromSetup(setup.direction);
  const confidencePercent = clamp(Math.round(setup.score * 100), 0, 100);
  const last = snap?.last_trade_price ?? null;
  const dayVwap = snap?.day_vwap;
  const prev = snap?.prev_close ?? last;
  const momentum = typeof last === "number" && typeof prev === "number" && prev > 0 ? ((last - prev) / prev) * 100 : 0;
  const base = clamp(50 + momentum * 6, 0, 100);

  const technical = clamp(base + 18, 0, 100);
  const newsDelta = hasNumericSentiment ? sentimentScore * 12 : headline ? 10 : -8;
  const news = clamp(base + newsDelta, 0, 100);
  const macro = clamp(base - 6, 0, 100);
  const sector = clamp(base + 4, 0, 100);
  const geopolitical = clamp(base - 11, 0, 100);
  const internals = clamp(base + 8, 0, 100);

  const layers: EvidenceLayer[] = [
    {
      key: "technical",
      icon: "📊",
      name: "Technical",
      status: statusFromScore(technical),
      weightPercent: 30,
      explanation: "Price action and trend structure are evaluated against intraday momentum.",
      keyPoints: ["—", "—", "—"],
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
        headline ? headline.slice(0, 40) : `No recent news for ${symbolUpper}`
      ],
      contributionScore: news,
      freshnessLabel:
        articleCount > 0 ? `News ${relativeNewsTime(first?.published_at)}` : `No recent news for ${symbolUpper}`
    },
    {
      key: "macro",
      icon: "🌍",
      name: "Macro",
      status: statusFromScore(macro),
      weightPercent: 14,
      explanation: "Rates and macro event pressure influence signal alignment and risk appetite.",
      keyPoints: ["—", "—", "—"],
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
      keyPoints: ["—", "—", "—"],
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
      keyPoints: ["—", "—", "—"],
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
      keyPoints: ["—", "—", "—"],
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

  return {
    symbol: setup.symbol,
    direction,
    directionBadgeLabel,
    confidencePercent,
    layers,
    confluence,
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
      articleCount > 0 ? `News ${relativeNewsTime(first?.published_at)}` : `No recent news for ${symbolUpper}`,
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

function parseHistoricalZone(raw: unknown): { low: number; high: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const low = numOrNull(o.low);
  const high = numOrNull(o.high);
  if (low == null || high == null || !(high > low)) return null;
  return { low, high };
}

/**
 * Parse swing-composite POST JSON into a structured insight. Returns null if core fields are missing.
 */
export function parseSwingCompositeInsight(body: Record<string, unknown>): SignalEvidenceInsight | null {
  const signal_score = numOrNull(body.signal_score);
  if (signal_score == null) return null;
  const trend_strength = String(body.trend_strength ?? "").trim() || "Moderate";
  const trend_direction = String(body.trend_direction ?? "").trim() || "Sideways";
  const risk_reward = numOrNull(body.risk_reward) ?? 1.5;
  const market_regime = String(body.market_regime ?? "Neutral").trim() || "Neutral";
  const confirming_signals = mapConfluenceChipList(body.confirming_signals);
  const conflicting_signals = mapConfluenceChipList(body.conflicting_signals);
  const catalystsRaw = body.catalysts;
  const catalysts: Array<{ text: string; sentiment: string }> = [];
  if (Array.isArray(catalystsRaw)) {
    for (const c of catalystsRaw.slice(0, 4)) {
      if (c && typeof c === "object") {
        const o = c as Record<string, unknown>;
        const text = String(o.text ?? "").trim();
        if (text) {
          const sent = String(o.sentiment ?? "neutral").toLowerCase();
          const sentiment =
            sent === "positive" || sent === "negative" || sent === "neutral" ? sent : "neutral";
          catalysts.push({ text: text.slice(0, 240), sentiment });
        }
      }
    }
  }
  const riskRaw = body.risk_factors;
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
  return {
    signal_score: clamp(Math.round(signal_score), 0, 100),
    trend_strength,
    trend_direction,
    risk_reward: Math.round(risk_reward * 10) / 10,
    market_regime,
    confirming_signals,
    conflicting_signals,
    catalysts,
    risk_factors,
    signal_parameters,
    historical_entry_zone,
    reference_target_1: numOrNull(body.reference_target_1),
    reference_target_2: numOrNull(body.reference_target_2),
    reference_stop_level: numOrNull(body.reference_stop_level)
  };
}

export function deriveEvidenceInsightFallback(evidence: SignalEvidenceData): SignalEvidenceInsight {
  const signal_score = clamp(evidence.confidencePercent, 0, 100);
  const trend_strength = signal_score >= 72 ? "Strong" : signal_score >= 48 ? "Moderate" : "Weak";
  const trend_direction =
    evidence.direction === "bullish" ? "Uptrend" : evidence.direction === "bearish" ? "Downtrend" : "Sideways";
  const { support, resistance, vwap } = evidence.keyLevels;
  const mid =
    typeof support === "number" && typeof resistance === "number"
      ? (support + resistance) / 2
      : typeof vwap === "number"
        ? vwap
        : 100;
  let risk_reward = 1.8;
  if (
    typeof support === "number" &&
    typeof resistance === "number" &&
    resistance > support &&
    mid > support &&
    mid < resistance
  ) {
    if (evidence.direction === "bullish") {
      risk_reward = (resistance - mid) / Math.max(0.01, mid - support);
    } else if (evidence.direction === "bearish") {
      risk_reward = (mid - support) / Math.max(0.01, resistance - mid);
    }
  }
  risk_reward = Math.round(clamp(risk_reward, 0.8, 3.5) * 10) / 10;
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
  const historical_entry_zone =
    typeof support === "number" && typeof resistance === "number" && resistance > support
      ? { low: Math.round(support * 10000) / 10000, high: Math.round(resistance * 10000) / 10000 }
      : typeof vwap === "number" && vwap > 0
        ? { low: Math.round(vwap * 0.99 * 10000) / 10000, high: Math.round(vwap * 1.01 * 10000) / 10000 }
        : null;
  const reference_target_1 =
    typeof resistance === "number" ? Math.round(resistance * 1.008 * 10000) / 10000 : null;
  const reference_target_2 =
    typeof resistance === "number" ? Math.round(resistance * 1.018 * 10000) / 10000 : null;
  const reference_stop_level = typeof support === "number" ? Math.round(support * 0.995 * 10000) / 10000 : null;
  const zoneTxt = historical_entry_zone
    ? `$${historical_entry_zone.low.toFixed(2)}–$${historical_entry_zone.high.toFixed(2)}`
    : "the Historical Entry Zone in the reference strip";
  const vwTxt = typeof vwap === "number" && vwap > 0 ? `$${vwap.toFixed(2)}` : "VWAP in the reference strip";
  const signal_parameters = `Consider observing how ${sym} behaves versus ${zoneTxt} on a closing basis before sizing any follow-up. Scale participation down when confirming layers diverge or when price cannot hold ${vwTxt}. Invalidate the constructive read on a decisive close back through the lower bound of the Historical Entry Zone for this horizon. Signal data only — not investment advice.`;
  return {
    signal_score,
    trend_strength,
    trend_direction,
    risk_reward,
    market_regime,
    confirming_signals,
    conflicting_signals,
    catalysts: catalysts.slice(0, 4),
    risk_factors: risk_factors.slice(0, 4),
    signal_parameters,
    historical_entry_zone,
    reference_target_1,
    reference_target_2,
    reference_stop_level
  };
}

export function applySwingCompositeEnrichment(
  evidence: SignalEvidenceData,
  body: Record<string, unknown> | null | undefined
): SignalEvidenceData {
  if (body == null || body.status === "insufficient_data") {
    return { ...evidence, insight: deriveEvidenceInsightFallback(evidence) };
  }
  const insight = parseSwingCompositeInsight(body) ?? deriveEvidenceInsightFallback(evidence);
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
        return { ...layer, keyPoints: ["—", "—", "—"] };
      }
      const chips = match.chips;
      if (Array.isArray(chips) && chips.length > 0) {
        return {
          ...layer,
          keyPoints: chips.map((c) => String(c).trim()).filter(Boolean).slice(0, 4)
        };
      }
      const reasoning = typeof match.reasoning === "string" ? match.reasoning.trim() : "";
      if (reasoning) {
        const parts = reasoning
          .split(".")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3);
        if (parts.length) {
          return { ...layer, keyPoints: parts };
        }
      }
      return { ...layer, keyPoints: ["—", "—", "—"] };
    });
  }

  return { ...evidence, layers, insight, confluence };
}
