import type { NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import { parseLaggardSignal, parseUnlockForecast, type LaggardSignal, type UnlockHint } from "@/lib/laggard";
import { parseCausalNarrativeFromApi } from "@/lib/signal-evidence/causal-narrative";
import {
  EVIDENCE_PLAIN_ENGLISH_LAYER_KEYS,
  evidenceLayerPlainEnglishExplanation,
  filterInternalLayerScoreCopy,
  layerCopyLooksInternal
} from "@/lib/signal-evidence/layer-plain-english";
import { signalLayerDisplayName } from "@/lib/signals/layer-display-names";
import { clampLayerScore, directionalToLayerScore } from "@/lib/signal-math/contract";
import {
  parseExecutionQuality,
  type ExecutionQualityPayload
} from "@/lib/signal-evidence/execution-quality";
import { parseLedgerGateSummary } from "@/lib/signal-evidence/ledger-gate-present";
import { parseApiDecisionState } from "@/lib/signal-evidence/risk-stack-present";
import {
  parseMarketEnvironment,
  type MarketEnvironmentPayload
} from "@/lib/signal-evidence/market-environment-present";
import {
  parseMarketContextDampening,
  parseMarketContextFlags,
  type MarketContextDampening,
  type MarketContextFlags
} from "@/lib/signal-evidence/market-context-present";
import {
  buildPlanningGatesClient,
  parsePlanningGates,
  type PlanningGatesPayload
} from "@/lib/signal-evidence/planning-gates-present";
import { isInDayDipWindowEt } from "@/lib/market-hours-et";
import { coerceSnapshotForReferenceLevels } from "@/lib/snapshot-reference-levels";
import { parseSetupJudgment, type SetupJudgment } from "@/lib/signal-evidence/setup-judgment";
import {
  roundRiskRewardDisplay,
  structureRiskRewardLong,
  structureRiskRewardShort
} from "@/lib/risk-reward-structure";
import {
  referenceStopAtrK,
  resolveMergedReferenceStop,
  resolveStructuralStopAnchor
} from "@/lib/scenario/reference-stop-resolve";
import type { ScenarioDirection } from "@/lib/scenario/types";
import {
  dailyBarsFromComposite,
  scanNearestResistanceAbove,
  scanNearestSupportBelow,
  type OhlcBar
} from "@/lib/structure-resistance-scanner";

// Wire-type contracts live in ./signal-evidence/wire-types and are re-exported
// here so existing `@/lib/signal-evidence` type imports keep working.
export type {
  EvidenceDirection,
  EvidenceStatus,
  SignalEvidenceFundamentalContext,
  GeoEventDetailRow,
  GeopoliticalLayerExtras,
  NewsLayerRating,
  NewsLayerAnalystConsensus,
  NewsLayerGuidance,
  NewsLayerEarningsResult,
  MacroUpcomingEventWire,
  MacroYieldCurveWire,
  SectorResolutionStateWire,
  SectorDailySessionWire,
  CompositeAlignmentLevelWire,
  CompositeAlignmentWire,
  EvidenceLayer,
  SignalEvidenceConfluence,
  SignalEvidenceInsight,
} from "./signal-evidence/wire-types";
import type {
  EvidenceDirection,
  EvidenceStatus,
  SignalEvidenceFundamentalContext,
  GeoEventDetailRow,
  GeopoliticalLayerExtras,
  NewsLayerRating,
  NewsLayerAnalystConsensus,
  NewsLayerGuidance,
  NewsLayerEarningsResult,
  MacroUpcomingEventWire,
  MacroYieldCurveWire,
  SectorResolutionStateWire,
  SectorDailySessionWire,
  CompositeAlignmentLevelWire,
  CompositeAlignmentWire,
  EvidenceLayer,
  SignalEvidenceConfluence,
  SignalEvidenceInsight,
} from "./signal-evidence/wire-types";

// VWAP display helpers live in ./signal-evidence/vwap-present and are re-exported
// here so existing `@/lib/signal-evidence` imports keep working.
export { VWAP_STATE, getVWAPTooltip, getVWAPDisplay } from "./signal-evidence/vwap-present";
import { VWAP_STATE, getVWAPTooltip, getVWAPDisplay } from "./signal-evidence/vwap-present";
import {
  parseDirectionConfidence,
  deriveDirectionConfidence,
  directionConfidenceFallbackReason,
} from "./signal-evidence/direction-confidence";

/**
 * Reconciler sentence for the confluence panel when there are chips
 * on both sides (confirming + conflicting) so the user can see which
 * way the OPPOSITE-polarity context is pushing without misreading
 * the chip labels themselves.
 *
 * Why this exists — and why the previous design was wrong (BRK-B
 * report, 2026-05-13):
 *
 *   The Confirming/Conflicting chip group is scoped to the setup
 *   *direction* (long / short). The confluence engine produces
 *   chip labels whose semantic polarity MATCHES the setup direction:
 *   for a long setup the confirming chips are bullish-aligned tags
 *   ("Sector leads market", "Bullish Regime", "Bullish Catalyst");
 *   for a short setup they are bearish-aligned tags ("Sector lags
 *   market", "Bearish Regime", "Bearish Catalyst"). The conflicting
 *   list is the opposite-polarity context that runs against the
 *   setup ("VWAP conflict", "EMA conflict", "Weak Volume", etc).
 *
 *   The previous reconciler assumed `direction` was the
 *   composite-resolved verdict (which could disagree with the setup
 *   direction) and that confirming chips were always bullish-polarity
 *   irrespective of setup. Both assumptions were false in
 *   production: `evidence.direction` is derived from the setup
 *   direction (`evidenceDirectionFromSetup(setup.direction)`), and
 *   chip polarity flips with setup direction. The combination meant
 *   short setups got "Bullish inputs present, but overridden by
 *   VWAP conflict + …" rendered against a chip group whose ONLY
 *   confirming entry described a bearish-aligned sector readout
 *   (then labelled "Sector Bearish", since renamed in confluence.py
 *   to "Sector lags market" for relative-strength clarity). The user
 *   (correctly) read that combination as a contradiction.
 *
 *   The fix: describe the conflicting-list polarity correctly. For
 *   a long setup, the conflicting chips are bearish-leaning context
 *   that runs against the long. For a short setup they're
 *   bullish-leaning context that runs against the short. The
 *   reconciler now names that opposite-polarity context and
 *   identifies what's still anchoring the setup (the confirming
 *   chips), which is symmetric and accurate for both directions.
 *
 * Returns `null` when there's nothing to reconcile — direction is
 * neutral, or there are no conflicting chips (no opposite-polarity
 * context to surface).
 */
export function buildVerdictTagReconciler(
  direction: EvidenceDirection,
  confirming: ReadonlyArray<{ label: string }>,
  conflicting: ReadonlyArray<{ label: string }>,
  geopoliticalDragActive: boolean = false
): string | null {
  if (direction !== "bullish" && direction !== "bearish") return null;
  if (conflicting.length === 0) return null;

  // Direction-word that appears in the body of the sentence — "long"
  // for a bullish setup, "short" for a bearish one. Reads more
  // naturally than "bullish setup" / "bearish setup" once embedded
  // ("anchor the short" >> "anchor the bearish setup").
  const directionWord = direction === "bullish" ? "long" : "short";

  const anchorList = confirming
    .map((c) => stripChipParenthetical(c.label))
    .filter((s) => s.length > 0)
    .slice(0, 4);

  const counterList = conflicting
    .map((c) => stripChipParenthetical(c.label))
    .filter((s) => s.length > 0)
    .slice(0, 4);

  // Geopolitical drag is surfaced from the macro layer (not always a chip
  // on the evidence card), so we splice it into the counterweights list
  // explicitly when active.
  if (geopoliticalDragActive && !counterList.some((f) => /geopolit/i.test(f))) {
    counterList.push("geopolitical drag");
  }

  if (counterList.length === 0) return null;

  // Shape of the sentence (BRK-B feedback, 2026-05-13):
  //   "Anchored by X; counterweight(s): Y." (confirming-first)
  // The previous shape led with the *opposite-polarity context* and the
  // word "Bullish-leaning" appearing on a short setup made the sentence
  // read as if the chip layout favoured the wrong direction. Leading
  // with the anchors makes it obvious what's supporting the setup
  // (which is what a trader needs first when scanning the verdict tag)
  // and the counterweights are still right there for risk awareness.
  const counterLabel = counterList.length === 1 ? "Counterweight" : "Counterweights";

  if (anchorList.length === 0) {
    // No confirming chips at all — the setup polarity isn't supported by
    // the chip rail. Say so plainly without leading with the conflicting
    // chips as if they were the headline.
    return `No confirming signals for the ${directionWord} setup; only opposing context: ${joinFactors(counterList)}.`;
  }

  return `Anchored by ${joinFactors(anchorList)}; ${counterLabel.toLowerCase()}: ${joinFactors(counterList)}.`;
}

function stripChipParenthetical(label: string): string {
  return label.replace(/\s*\(.*?\)\s*/g, " ").trim();
}

function joinFactors(parts: ReadonlyArray<string>): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} + ${parts[1]}`;
  return `${parts.slice(0, -1).join(" + ")} + ${parts[parts.length - 1]}`;
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
  /**
   * Price the engine used when it computed this signal (T0). Sourced
   * from `IntradaySetupPayload.last_price` — the scanner persists the
   * snapshot price at signal-emit time onto every row it returns. The
   * evidence card pairs this with `lastTradePrice` (T1, captured at
   * card-open time) to surface drift since the engine ran; see
   * `lib/signal-evidence/signal-price-display.ts` for the display
   * helper and tier banding. Null when the upstream row didn't carry
   * a price (e.g. synthetic-from-gap path, manual test fixtures).
   */
  priceAtSignal?: number | null;
  prevClose?: number | null;
  updatedLabel: string;
  newsFreshnessLabel: string;
  /** ISO string used for `updatedLabel`; lets the card clamp invalid or very stale timestamps. */
  updatedAtIso?: string | null;
  earningsRisk?: {
    daysUntil: number;
    reportTime: "before_market" | "after_market" | "during_market" | "unknown";
    risk?: "imminent" | "elevated" | "watch" | "normal";
    reportDate?: string;
    chip?: string;
  } | null;
  /** Swing-only fundamental backdrop from composite (paid users; null when gated or unavailable). */
  fundamentalContext?: SignalEvidenceFundamentalContext | null;
  /** Swing-only peer divergence context from composite (`laggard_signal`). */
  laggardSignal?: LaggardSignal | null;
  /** Swing-only layer unlock hints from composite (`unlock_forecast`). */
  unlockForecast?: UnlockHint[];
  confluence?: SignalEvidenceConfluence | null;
  /** Populated from swing composite JSON or derived locally for consistent evidence UI. */
  insight?: SignalEvidenceInsight | null;
  /** Set when evidence is merged from composite day/swing API responses. */
  compositeMode?: "day" | "swing";
  signal_basis?: string;
  signal_basis_label?: string;
  /** Present after composite enrichment when backend sends `alignment`. */
  alignment?: CompositeAlignmentWire | null;
  /** Informational causal narrative from composite (`causal_narrative`). */
  causalNarrative?: import("@/lib/signal-evidence/causal-narrative").CausalNarrative | null;
  /** Soft execution-quality metrics from composite (informational; not a gate). */
  executionQuality?: ExecutionQualityPayload | null;
  planningGates?: PlanningGatesPayload | null;
  /** Layer 0 VIX environment policy from composite (`market_environment`). */
  marketEnvironment?: MarketEnvironmentPayload | null;
  /** Advisory IPO / index-inclusion flags from composite (`market_context_flags`). */
  marketContextFlags?: MarketContextFlags | null;
  /** Layer weight dampening applied for mechanical-flow windows (`market_context_dampening`). */
  marketContextDampening?: MarketContextDampening | null;
  /** Layer 3 ledger gate checklist from composite (`gate_status` / `ledger_qualified`). */
  ledgerGateSummary?: import("@/lib/signal-evidence/ledger-gate-present").LedgerGateSummary | null;
  /** Authoritative tri-state from composite API (`decision_state`), when present. */
  apiDecisionState?: import("@/lib/signal-evidence/trade-decision").TradeDecisionState | null;
  /** Raw composite JSON used for enrichment (weekly / timeframe fields). */
  compositePayload?: Record<string, unknown> | null;
  /** When a layer failed fetch and was excluded from composite scoring. */
  layersExcludedNote?: string | null;
  /** Quality vs tradeability judgment (no hero score — process, phase, blockers). */
  setupJudgment?: SetupJudgment | null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function parseFundamentalContext(raw: unknown): SignalEvidenceFundamentalContext | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const backdrop = o.backdrop;
  if (backdrop !== "positive" && backdrop !== "neutral" && backdrop !== "mixed" && backdrop !== "weak") {
    return null;
  }
  const num = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k] as number) ? (o[k] as number) : 0);
  const pick = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
    const v = o[k];
    return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  };
  return {
    backdrop,
    earnings_trend: pick("earnings_trend", ["beating", "missing", "inline", "unknown"], "unknown"),
    guidance_direction: pick("guidance_direction", ["raised", "lowered", "maintained", "unknown"], "unknown"),
    analyst_direction: pick("analyst_direction", ["upgrading", "downgrading", "stable", "unknown"], "unknown"),
    revenue_trend: pick("revenue_trend", ["growing", "flat", "declining", "unknown"], "unknown"),
    summary_line: typeof o.summary_line === "string" ? o.summary_line : "",
    data_quality:
      o.data_quality === "high" || o.data_quality === "medium" || o.data_quality === "low" ? o.data_quality : "low",
    quarters_beating: num("quarters_beating"),
    quarters_missing: num("quarters_missing"),
    recent_upgrades: num("recent_upgrades"),
    recent_downgrades: num("recent_downgrades"),
    sector_display_name: typeof o.sector_display_name === "string" ? o.sector_display_name : null,
    sector_etf: typeof o.sector_etf === "string" ? o.sector_etf : null
  };
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
  const lk = (layerKey ?? "").trim().toLowerCase();
  if (layerStatus === "degraded") {
    patch.contributionScore = null;
    patch.status = "Unavailable";
    if (lk === "news") {
      const ds = typeof match.data_state === "string" ? match.data_state.trim() : "";
      patch.news_data_state = ds || "degraded";
    }
    return patch;
  }
  if (layerStatus === "as_of_close") {
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
    } else if (patch.contributionScore != null) {
      patch.status = statusFromScore(patch.contributionScore);
    }
    patch.freshnessLabel = "As of close · daily structure";
    if (lk === "technical") {
      patch.explanation =
        typeof match.reasoning === "string" && match.reasoning.trim()
          ? match.reasoning.trim()
          : "Daily structure as of last close; intraday VWAP/ORB apply when the regular session opens.";
    }
    return patch;
  }
  if (layerStatus === "unavailable") {
    // Closed-session convention: keep last computed layer score, but mark it explicitly as stale close data.
    if (typeof raw === "number" && Number.isFinite(raw)) {
      patch.contributionScore = clamp(Math.round(raw), 0, 100);
      patch.status = "As of close";
      return patch;
    }
    patch.contributionScore = null;
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
  } else if (patch.contributionScore != null) {
    patch.status = statusFromScore(patch.contributionScore);
  }

  if (lk === "news") {
    const wim = typeof match.wim_summary === "string" && match.wim_summary.trim() ? match.wim_summary.trim() : undefined;
    if (wim) patch.wim_summary = wim;
    const ds = typeof match.data_state === "string" ? match.data_state.trim() : undefined;
    if (ds) patch.news_data_state = ds;
    const afs = typeof match.analyst_feed_state === "string" ? match.analyst_feed_state.trim() : undefined;
    if (afs) patch.analyst_feed_state = afs;
    const hs = numOrNull(match.headline_sentiment);
    if (hs != null) patch.headline_sentiment = hs;
    const ass = numOrNull(match.analyst_sub_score);
    if (ass != null) patch.analyst_sub_score = ass;
    const ac = numOrNull(match.article_count ?? match.articles_count);
    if (ac != null) patch.articles_count = ac;

    const lrRaw = match.latest_rating;
    if (lrRaw && typeof lrRaw === "object") {
      const o = lrRaw as Record<string, unknown>;
      patch.latest_rating = {
        action: String(o.action ?? "").trim(),
        rating: String(o.rating ?? "").trim(),
        firm: String(o.firm ?? "").trim(),
        date: String(o.date ?? o.date_str ?? "").trim(),
        price_target:
          typeof o.price_target === "number" && Number.isFinite(o.price_target) ? o.price_target : null,
        upside_pct: typeof o.upside_pct === "number" && Number.isFinite(o.upside_pct) ? o.upside_pct : null,
        firm_tier: typeof o.firm_tier === "string" ? o.firm_tier : undefined
      };
    }
    const acRaw = match.analyst_consensus;
    if (acRaw && typeof acRaw === "object") {
      const c = acRaw as Record<string, unknown>;
      patch.analyst_consensus = {
        upgrades_30d: Number(c.upgrades_30d ?? 0) || 0,
        downgrades_30d: Number(c.downgrades_30d ?? 0) || 0,
        momentum: Number(c.momentum ?? 0) || 0,
        label: typeof c.label === "string" ? c.label : null,
        unique_firms: c.unique_firms === true
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
    const etf = String(match.sector_etf ?? "").trim().toUpperCase();
    if (etf) patch.sector_etf = etf;
    const display = String(match.sector_display_name ?? "").trim();
    if (display) patch.sector_display_name = display;
    const bucket = String(match.sector_bucket ?? "").trim();
    if (bucket) patch.sector_bucket = bucket;
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
          (articleCount > 0 ? `${articleCount} recent articles` : "No active catalyst")
      ],
      contributionScore: news,
      freshnessLabel:
        articleCount > 0 ? `News ${relativeNewsTime(newsPublishedAt)}` : "No active catalyst"
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
      name: signalLayerDisplayName("internals"),
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
            detail: c.detail ? String(c.detail) : undefined,
            source: typeof c.source === "string" && c.source.trim().length > 0 ? c.source.trim() : undefined
          })),
          conflicting_signals: (setup.conflicting_signals ?? []).map((c) => ({
            label: String(c.label ?? ""),
            detail: c.detail ? String(c.detail) : undefined,
            source: typeof c.source === "string" && c.source.trim().length > 0 ? c.source.trim() : undefined
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

  // Scanner persists the snapshot price at signal-emit time onto every
  // row via `IntradaySetupPayload.last_price`. We hold it on the
  // evidence payload as the "computed at" anchor for the drift row
  // (see `lib/signal-evidence/signal-price-display.ts`). Defensive on
  // every shape the scanner has historically emitted: missing,
  // non-finite, zero, and negative all degrade to `null` so the drift
  // row renders only when the data is real.
  const setupPriceRaw = setup.last_price;
  const priceAtSignal =
    typeof setupPriceRaw === "number" && Number.isFinite(setupPriceRaw) && setupPriceRaw > 0
      ? setupPriceRaw
      : null;

  return {
    symbol: setup.symbol,
    direction,
    directionBadgeLabel,
    confidencePercent,
    layers,
    confluence,
    lastTradePrice: typeof last === "number" && Number.isFinite(last) && last > 0 ? last : null,
    priceAtSignal,
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
      articleCount > 0 ? `News ${relativeNewsTime(newsPublishedAt)}` : "No active catalyst",
    earningsRisk:
      typeof options?.earningsRiskDays === "number" && options.earningsRiskDays >= 0 && options.earningsRiskDays <= 3
        ? {
            daysUntil: options.earningsRiskDays,
            reportTime: options.earningsReportTime || "unknown"
          }
        : null
  };
}

function mapConfluenceChipList(raw: unknown): Array<{ label: string; detail?: string; source?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map((c) => ({
      label: String(c.label ?? c.name ?? "").trim(),
      detail: c.detail != null ? String(c.detail).trim() : undefined,
      // Pass the backend's `source` enum value through to the frontend
      // so `rankConflictingSignals` can sort by priority. Backwards-
      // compatible: legacy chips without a source still flow through
      // — they just sort to the tail of the ranked list.
      source: typeof c.source === "string" && c.source.trim().length > 0 ? c.source.trim() : undefined
    }))
    .filter((c) => c.label.length > 0);
}

/**
 * Priority order for conflicting-signal chips (BRK.B feedback,
 * 2026-05-13). When the chip rail surfaces 2+ counterweights, the
 * first three are labelled Primary / Secondary / Tertiary so the user
 * sees at a glance which conflict matters most for the setup. Order
 * reflects load-bearing weight in intraday/swing decisions:
 *
 *   1. VWAP rejection  — primary technical anchor; price on the wrong
 *                        side of session VWAP is a first-order miss.
 *   2. Weak volume     — execution-quality friction; low participation
 *                        meaningfully lowers continuation odds.
 *   3. EMA misalignment — secondary trend-stack signal; informative
 *                         but typically downstream of VWAP.
 *   4. Internals       — broad-market direction off; context.
 *   5. Sector          — relative-strength context.
 *   6. Macro regime    — slow-moving context.
 *   7. News catalyst   — discrete event signal.
 *   8. Gap confirm     — entry-timing signal.
 *   9. ORB breakout    — entry-timing signal.
 *
 * Any chip whose source is not in the map sorts to the tail (rank
 * Infinity → preserves original relative order for unknown sources).
 */
export const CONFLICT_PRIORITY_BY_SOURCE: Readonly<Record<string, number>> = {
  vwap_position: 1,
  volume_confirm: 2,
  ema_9_position: 3,
  internals_alignment: 4,
  sector_alignment: 5,
  market_regime: 6,
  news_catalyst: 7,
  gap_confirm: 8,
  orb_breakout: 9
};

export function rankConflictingSignals<T extends { source?: string }>(chips: readonly T[]): T[] {
  // Stable sort: equal-priority chips keep their original order. We
  // achieve stability via index pairing because Array.prototype.sort
  // is only guaranteed stable on TC39 2019+; this guard keeps the
  // contract explicit so a future engine version can't quietly break
  // chip ordering.
  return chips
    .map((c, idx) => ({ c, idx, rank: CONFLICT_PRIORITY_BY_SOURCE[c.source ?? ""] ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.rank - b.rank) || (a.idx - b.idx))
    .map(({ c }) => c);
}

/**
 * Tier label for the top-3 conflicting chips after `rankConflictingSignals`.
 * Returns `null` for any index past 2 OR when the total conflict count
 * is below 2 (a single conflict needs no tier label — there is no
 * ranking to communicate). Exported so the evidence-card render and
 * its lock-in tests share a single source of truth.
 */
export function conflictTierLabel(index: number, total: number): "PRIMARY" | "SECONDARY" | "TERTIARY" | null {
  if (total < 2 || index < 0 || index > 2) return null;
  if (index === 0) return "PRIMARY";
  if (index === 1) return "SECONDARY";
  return "TERTIARY";
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
    return Math.round(clampLayerScore(explicit));
  }
  const strength = numOrNull(body.signal_strength);
  if (strength != null) {
    return Math.round(clampLayerScore(strength * 100));
  }
  const sc = numOrNull(body.score);
  if (sc != null) {
    // Signal Math Contract: directional (-1..+1) → layer/UI score (0..100), 0 → 50.
    return Math.round(directionalToLayerScore(sc));
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

function parseSwingRangeZone(
  raw: unknown
): { low: number; high: number; sessions?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const low = numOrNull(o.low);
  const high = numOrNull(o.high);
  if (low == null || high == null || !(high > low)) return null;
  const sessions = numOrNull(o.sessions);
  return {
    low,
    high,
    ...(sessions != null && sessions > 0 ? { sessions: Math.round(sessions) } : {})
  };
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
  dailyBars?: OhlcBar[];
  atr?: number | null;
  tradingMode?: string;
}): {
  stop: number | null;
  target1: number | null;
  target2: number | null;
  target2Provenance: "2r_extension" | "t1_bump" | "resistance" | null;
} {
  const { dayLo, dayHi, vwap, prevClose, last, dailyBars = [], atr, tradingMode = "swing" } = opts;
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
  let target2Provenance: "2r_extension" | "t1_bump" | "resistance" | null = null;
  const entryGuess = last != null && last > 0 ? last : null;
  if (dailyBars.length && entryGuess != null && reference_target_1 != null) {
    const structuralT2 = scanNearestResistanceAbove(dailyBars, {
      last: entryGuess,
      floorAbove: reference_target_1,
      atr,
      tradingMode
    });
    if (structuralT2 != null) {
      reference_target_2 = structuralT2;
      target2Provenance = "resistance";
    }
  }
  if (
    reference_target_2 == null &&
    reference_target_1 != null &&
    reference_stop != null &&
    entryGuess != null &&
    entryGuess > reference_stop
  ) {
    const t2R = entryGuess + 2.0 * (entryGuess - reference_stop);
    if (t2R > reference_target_1 + 1e-6) {
      reference_target_2 = roundPrice4(t2R);
      target2Provenance = "2r_extension";
    }
  }
  if (reference_target_2 == null && reference_target_1 != null && last != null && last > 0) {
    reference_target_2 = roundPrice4(reference_target_1 * 1.004);
    target2Provenance = "t1_bump";
  }
  return { stop: reference_stop, target1: reference_target_1, target2: reference_target_2, target2Provenance };
}

function shortSideGeometry(opts: {
  dayLo: number | null;
  dayHi: number | null;
  vwap: number | null;
  prevClose: number | null;
  last: number | null;
  dailyBars?: OhlcBar[];
  atr?: number | null;
  tradingMode?: string;
}): {
  stop: number | null;
  target1: number | null;
  target2: number | null;
  target2Provenance: "2r_extension" | "t1_bump" | "resistance" | null;
} {
  const { dayLo, dayHi, vwap, prevClose, last, dailyBars = [], atr, tradingMode = "swing" } = opts;
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
  let target2Provenance: "2r_extension" | "t1_bump" | "resistance" | null = null;
  const entryGuess = last != null && last > 0 ? last : null;
  if (dailyBars.length && entryGuess != null && reference_target_1 != null) {
    const structuralT2 = scanNearestSupportBelow(dailyBars, {
      last: entryGuess,
      ceilingBelow: reference_target_1,
      atr,
      tradingMode
    });
    if (structuralT2 != null) {
      reference_target_2 = structuralT2;
      target2Provenance = "resistance";
    }
  }
  if (
    reference_target_2 == null &&
    reference_target_1 != null &&
    reference_stop != null &&
    entryGuess != null &&
    reference_stop > entryGuess
  ) {
    const t2R = entryGuess - 2.0 * (reference_stop - entryGuess);
    if (t2R < reference_target_1 - 1e-6) {
      reference_target_2 = roundPrice4(t2R);
      target2Provenance = "2r_extension";
    }
  }
  if (reference_target_2 == null && reference_target_1 != null && last != null && last > 0) {
    reference_target_2 = roundPrice4(reference_target_1 * 0.996);
    target2Provenance = "t1_bump";
  }
  return { stop: reference_stop, target1: reference_target_1, target2: reference_target_2, target2Provenance };
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
  atr?: number | null;
  tradingMode?: "day" | "swing" | null;
  swingLow?: number | null;
  swingHigh?: number | null;
  dailyBars?: OhlcBar[];
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
  reference_target_2_provenance: "2r_extension" | "t1_bump" | "resistance" | null;
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
  const atr =
    typeof input.atr === "number" && Number.isFinite(input.atr) && input.atr > 0 ? input.atr : null;
  const tradingMode = input.tradingMode ?? "swing";

  const useLong = useLongRrStructure(input.direction, dayLo, dayHi, last);
  const scenarioDir: ScenarioDirection = useLong ? "bullish" : "bearish";
  const g = useLong
    ? longSideGeometry({
        dayLo,
        dayHi,
        vwap,
        prevClose,
        last,
        dailyBars: input.dailyBars,
        atr,
        tradingMode
      })
    : shortSideGeometry({ dayLo, dayHi, vwap, prevClose, last, dailyBars: input.dailyBars, atr, tradingMode });

  const structural = resolveStructuralStopAnchor({
    direction: scenarioDir,
    sessionLow: dayLo,
    sessionHigh: dayHi,
    vwap,
    prevClose,
    last,
    swingLow: input.swingLow ?? null,
    swingHigh: input.swingHigh ?? null
  });
  const entry = entryPriceForRr(last, dayLo, dayHi);
  let reference_stop_level = g.stop;
  if (entry != null && structural != null) {
    const merged = resolveMergedReferenceStop({
      direction: scenarioDir,
      entry,
      structuralStop: structural,
      atr,
      atrK: referenceStopAtrK({ tradingMode: input.tradingMode ?? null })
    });
    if (merged.stop != null) reference_stop_level = merged.stop;
  }

  let reference_target_2 = g.target2;
  // Carry the geometry's T2 provenance so the R/R gate can tell a resistance-anchored
  // T2 (gate-eligible) from an unanchored projection. Dropping it here made every
  // structure-derived T2 look ineligible, so headline R/R never benefited from a
  // valid resistance-anchored extension.
  let reference_target_2_provenance = g.target2Provenance;

  return {
    reference_stop_level,
    reference_target_1: g.target1,
    reference_target_2,
    reference_target_2_provenance
  };
}

export function analystLevelsFromComposite(comp: Record<string, unknown> | null | undefined): number[] | undefined {
  if (!comp) return undefined;
  const raw = comp.analyst_target_levels;
  if (!Array.isArray(raw)) return undefined;
  const out: number[] = [];
  for (const row of raw) {
    const pt = numOrNull(row);
    if (pt != null && pt > 0) out.push(pt);
  }
  return out.length ? out : undefined;
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
  const isNeutralTrend = trend_direction === "Sideways" || trend_direction === "Reversing";
  const direction_confidence =
    parseDirectionConfidence(body.direction_confidence) ??
    deriveDirectionConfidence({
      score: numOrNull(body.score),
      signalScore0to100: signal_score,
      alignmentRatio: numOrNull(body.alignment_ratio),
      confidence: numOrNull(body.signal_strength),
      isNeutral: isNeutralTrend,
    });
  const direction_confidence_score =
    numOrNull(body.direction_confidence_score) ?? undefined;
  const direction_confidence_reason =
    typeof body.direction_confidence_reason === "string" && body.direction_confidence_reason.trim()
      ? body.direction_confidence_reason.trim()
      : directionConfidenceFallbackReason(direction_confidence, isNeutralTrend);
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
  const session_entry_zone = parseHistoricalZone(body.session_entry_zone) ?? historical_entry_zone;
  const ideal_pullback_zone = parseHistoricalZone(body.ideal_pullback_zone);
  const entry_zone_quality =
    typeof body.entry_zone_quality === "string" && body.entry_zone_quality.trim()
      ? body.entry_zone_quality.trim()
      : null;
  const entry_zone_worst_case_rr = numOrNull(body.entry_zone_worst_case_rr);
  const entry_style_raw = String(body.entry_style ?? "").trim().toLowerCase();
  const entry_style =
    entry_style_raw === "pullback" || entry_style_raw === "breakout" ? entry_style_raw : null;
  const entry_anchor = numOrNull(body.entry_anchor);
  const entry_distance_atr = numOrNull(body.entry_distance_atr);
  const zone_width_atr = numOrNull(body.zone_width_atr);
  const tierRaw = String(body.entry_distance_tier ?? "").trim().toLowerCase();
  const entry_distance_tier =
    tierRaw === "ideal" || tierRaw === "acceptable" || tierRaw === "chasing" ? tierRaw : null;
  const eqRaw = String(body.entry_quality_tier ?? "").trim().toLowerCase();
  const entry_quality_tier = eqRaw === "high" || eqRaw === "medium" || eqRaw === "low" ? eqRaw : null;
  const swing_range_zone = parseSwingRangeZone(body.swing_range_zone);
  const reference_stop_provenance =
    typeof body.reference_stop_provenance === "string" && body.reference_stop_provenance.trim()
      ? body.reference_stop_provenance.trim()
      : null;
  const reference_target_provenance =
    typeof body.reference_target_provenance === "string" && body.reference_target_provenance.trim()
      ? body.reference_target_provenance.trim()
      : null;
  const reference_target_2_provenance =
    typeof body.reference_target_2_provenance === "string" && body.reference_target_2_provenance.trim()
      ? body.reference_target_2_provenance.trim()
      : null;
  const vwapRaw = numOrNull(body.vwap ?? body.day_vwap);
  const vwap_state_parsed = String(body.vwap_state ?? "").trim() || undefined;
  const vwap_display_parsed = String(body.vwap_display ?? "").trim() || undefined;
  const vwap_tooltip_parsed = String(body.vwap_tooltip ?? "").trim() || undefined;
  const analystTargetLevelsRaw = body.analyst_target_levels;
  const analyst_target_levels: number[] = [];
  if (Array.isArray(analystTargetLevelsRaw)) {
    for (const row of analystTargetLevelsRaw) {
      const pt = numOrNull(row);
      if (pt != null && pt > 0) analyst_target_levels.push(pt);
    }
  }
  const analystSourceRaw = String(body.analyst_target_source ?? "").trim().toLowerCase();
  const analyst_target_source =
    analystSourceRaw === "benzinga" || analystSourceRaw === "perplexity" || analystSourceRaw === "none"
      ? analystSourceRaw
      : analyst_target_levels.length
        ? "benzinga"
        : "none";
  return {
    signal_score,
    trend_strength,
    trend_direction,
    direction_confidence,
    direction_confidence_score,
    direction_confidence_reason,
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
    session_entry_zone,
    entry_zone_quality,
    entry_zone_worst_case_rr,
    entry_style,
    entry_anchor,
    entry_distance_atr,
    zone_width_atr,
    entry_distance_tier,
    entry_quality_tier,
    ideal_pullback_zone,
    swing_range_zone,
    reference_target_1: numOrNull(body.reference_target_1),
    reference_target_2: numOrNull(body.reference_target_2),
    reference_target_2_provenance,
    reference_stop_level: numOrNull(body.reference_stop_level),
    reference_stop_provenance,
    reference_target_provenance,
    atr: numOrNull(body.atr),
    vwap: vwapRaw != null && vwapRaw > 0 ? Math.round(vwapRaw * 10000) / 10000 : null,
    vwap_state: vwap_state_parsed,
    vwap_display: vwap_display_parsed,
    vwap_tooltip: vwap_tooltip_parsed,
    is_complete: body.is_complete === false ? false : true,
    missing_fields: Array.isArray(body.missing_fields) ? body.missing_fields.map((x) => String(x)) : [],
    alignment_ratio: numOrNull(body.alignment_ratio) ?? undefined,
    conflicted_layers: Array.isArray(body.conflicted_layers) ? body.conflicted_layers.map((x) => String(x)) : [],
    analyst_target_levels: analyst_target_levels.length ? analyst_target_levels : undefined,
    analyst_target_source
  };
}

export function deriveEvidenceInsightFallback(evidence: SignalEvidenceData): SignalEvidenceInsight {
  const signal_score = clamp(evidence.confidencePercent, 0, 100);
  const trend_strength = signal_score >= 72 ? "Strong" : signal_score >= 48 ? "Moderate" : "Weak";
  const trend_direction =
    evidence.direction === "bullish" ? "Uptrend" : evidence.direction === "bearish" ? "Downtrend" : "Sideways";
  const direction_confidence = deriveDirectionConfidence({
    signalScore0to100: signal_score,
    confidence: evidence.confidencePercent / 100,
    isNeutral: evidence.direction === "neutral",
  });
  const direction_confidence_reason = directionConfidenceFallbackReason(
    direction_confidence,
    evidence.direction === "neutral"
  );
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

  const {
    reference_stop_level,
    reference_target_1,
    reference_target_2,
    reference_target_2_provenance
  } = referenceLevelsFromSessionStructure({
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
      ? structureRiskRewardLong(
          entry,
          reference_target_1,
          reference_stop_level,
          reference_target_2 ?? null,
          reference_target_2_provenance
        )
      : structureRiskRewardShort(
          entry,
          reference_target_1,
          reference_stop_level,
          reference_target_2 ?? null,
          reference_target_2_provenance
        );
  }
  const risk_reward =
    rrFromStructure != null
      ? roundRiskRewardDisplay(rrFromStructure)
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
    direction_confidence,
    direction_confidence_reason,
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

export function sanitizeEvidenceChips(rawChips: string[], layerKey?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of rawChips) {
    const chip = String(raw || "").trim();
    if (!chip) continue;
    const lower = chip.toLowerCase();
    if (lower === "analyst feed unavailable") continue;
    if (/^sentiment score\b/i.test(chip)) continue;
    if (layerKey && layerCopyLooksInternal(chip)) continue;
    if (lower.includes("expired")) continue;
    if (lower.startsWith("orb") && lower.includes("unavailable")) continue;
    const mapped = ORB_CHIP_REMAP[chip] ?? ORB_CHIP_REMAP[chip.trim()];
    const next = (mapped !== undefined ? mapped : chip).trim();
    if (!next) continue;
    const key = next.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

function finalizeEnrichedEvidenceLayer(
  layer: EvidenceLayer,
  apiLayer: Partial<EvidenceLayer>,
  keyPoints: string[],
  maxChips: number,
  fin: (merged: EvidenceLayer) => EvidenceLayer
): EvidenceLayer {
  const merged: EvidenceLayer = { ...layer, ...apiLayer };
  const explanation = EVIDENCE_PLAIN_ENGLISH_LAYER_KEYS.has(layer.key)
    ? evidenceLayerPlainEnglishExplanation(merged)
    : merged.explanation;
  const points = sanitizeEvidenceChips(filterInternalLayerScoreCopy(layer.key, keyPoints), layer.key).slice(
    0,
    maxChips
  );
  return fin({ ...merged, explanation, keyPoints: points });
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
          if (parts.length) {
            return finalizeEnrichedEvidenceLayer(layer, {}, parts, 4, (m) => m);
          }
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
        return finalizeEnrichedEvidenceLayer(layer, apiLayer, raw, maxChips, fin);
      }
      const reasoning = typeof match.reasoning === "string" ? match.reasoning.trim() : "";
      if (reasoning) {
        const parts = reasoningToKeyPoints(reasoning, maxChips);
        if (parts.length) {
          return finalizeEnrichedEvidenceLayer(layer, apiLayer, parts, maxChips, fin);
        }
      }
      const contrib = findContributionRow(body, layer.key);
      const contribR = typeof contrib?.reasoning === "string" ? contrib.reasoning.trim() : "";
      if (contribR) {
        const parts = reasoningToKeyPoints(contribR, maxChips);
        if (parts.length) return finalizeEnrichedEvidenceLayer(layer, apiLayer, parts, maxChips, fin);
      }
      const synth = synthKeyPointsFromLayerApi(match);
      if (synth.length) {
        return finalizeEnrichedEvidenceLayer(layer, apiLayer, synth, maxChips, fin);
      }
      const merged = { ...layer, ...apiLayer };
      const explanation = EVIDENCE_PLAIN_ENGLISH_LAYER_KEYS.has(layer.key)
        ? evidenceLayerPlainEnglishExplanation({ ...layer, ...apiLayer })
        : merged.explanation;
      return fin({ ...merged, explanation });
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

  let earningsRisk = evidence.earningsRisk;
  if (cm === "swing") {
    const daysAway = body.earnings_days_away;
    const riskRaw = body.earnings_risk;
    const riskLevel =
      riskRaw === "imminent" || riskRaw === "elevated" || riskRaw === "watch" || riskRaw === "normal"
        ? riskRaw
        : undefined;
    if (typeof daysAway === "number" && Number.isFinite(daysAway) && daysAway >= 0 && daysAway <= 7 && riskLevel !== "normal") {
      const rt = body.earnings_report_time;
      const reportTime =
        rt === "before_market" || rt === "after_market" || rt === "during_market" ? rt : "unknown";
      earningsRisk = {
        daysUntil: Math.round(daysAway),
        reportTime,
        risk: riskLevel,
        reportDate: typeof body.upcoming_earnings_date === "string" ? body.upcoming_earnings_date : undefined,
        chip: typeof body.earnings_chip === "string" ? body.earnings_chip : undefined
      };
    }
  }

  const fundamentalContext =
    cm === "swing" ? parseFundamentalContext(body.fundamental_context) ?? evidence.fundamentalContext ?? null : null;

  const laggardSignal =
    cm === "swing" ? parseLaggardSignal(body.laggard_signal) ?? evidence.laggardSignal ?? null : null;
  const unlockForecast =
    cm === "swing" ? parseUnlockForecast(body.unlock_forecast) : evidence.unlockForecast ?? [];

  const causalFromApi = parseCausalNarrativeFromApi(body.causal_narrative);
  const executionQuality = parseExecutionQuality(body);
  const setupJudgment = parseSetupJudgment(body) ?? evidence.setupJudgment ?? null;
  const modeForGates: "day" | "swing" = cm === "day" ? "day" : "swing";
  const marketEnvironment = parseMarketEnvironment(body);
  const marketContextFlags = parseMarketContextFlags(body);
  const marketContextDampening = parseMarketContextDampening(body);
  const ledgerGateSummary = parseLedgerGateSummary(body) ?? evidence.ledgerGateSummary ?? null;
  const apiDecisionState = parseApiDecisionState(body.decision_state) ?? evidence.apiDecisionState ?? null;
  const planningGates =
    parsePlanningGates(body) ??
    buildPlanningGatesClient({
      mode: modeForGates,
      marketRegime: insight.market_regime,
      riskReward: insight.risk_reward,
      executionQuality: executionQuality ?? evidence.executionQuality ?? null,
      referenceStopProvenance: insight.reference_stop_provenance ?? null,
      atr: insight.atr ?? numOrNull(body.atr),
      setupJudgment,
      inDayDipWindow: modeForGates === "day" ? isInDayDipWindowEt() : undefined
    });

  const layersExcludedNote =
    typeof body.layers_excluded_note === "string" && body.layers_excluded_note.trim()
      ? body.layers_excluded_note.trim()
      : evidence.layersExcludedNote ?? null;

  return {
    ...evidence,
    compositeMode: cm ?? evidence.compositeMode,
    signal_basis,
    signal_basis_label,
    keyLevels,
    layers,
    insight,
    confluence,
    alignment: alignmentMerged,
    earningsRisk,
    fundamentalContext,
    laggardSignal,
    unlockForecast: unlockForecast.length ? unlockForecast : undefined,
    causalNarrative: causalFromApi ?? evidence.causalNarrative ?? null,
    executionQuality: executionQuality ?? evidence.executionQuality ?? null,
    planningGates: planningGates ?? evidence.planningGates ?? null,
    marketEnvironment: marketEnvironment ?? evidence.marketEnvironment ?? null,
    marketContextFlags: marketContextFlags ?? evidence.marketContextFlags ?? null,
    marketContextDampening: marketContextDampening ?? evidence.marketContextDampening ?? null,
    ledgerGateSummary,
    apiDecisionState,
    compositePayload: body,
    layersExcludedNote,
    setupJudgment
  };
}

/**
 * Trading-mode that selects which composite engine answers an evidence enrichment call.
 * `"swing"` → `/composite/swing` (daily-bar engine), `"day"` → `/composite/real` (intraday engine).
 * Wiring must match the row's origin: swing setups → swing engine, day setups → day engine.
 * Mismatches silently leak intraday chips (VWAP / EMA9 / ORB) into swing reads and vice versa.
 */
export type EvidenceCompositeMode = "swing" | "day";

function compositeRouteForMode(mode: EvidenceCompositeMode): string {
  return mode === "swing"
    ? "/api/stocvest/signals/composite/swing"
    : "/api/stocvest/signals/composite/real";
}

/**
 * Merges composite-engine API layer chips / reasoning into evidence (same-origin BFF).
 *
 * Callers MUST pass the mode that matches the row that opened the modal:
 *   - Dashboard Swing Desk → `"swing"`
 *   - Dashboard Day Desk → `"day"`
 *   - Signals page → row's `tradingMode`
 *   - Scanner setup / gap cards → `scannerSetupMode === "day" ? "day" : "swing"`
 *
 * The backend response is tagged `body.mode` and that drives the chip-filter (`filterChipsForMode`)
 * inside `applySwingCompositeEnrichment`, so the only way swing reads can carry intraday-only
 * chips is if the wrong route was called here.
 */
export async function enrichEvidenceWithComposite(
  evidence: SignalEvidenceData,
  mode: EvidenceCompositeMode
): Promise<SignalEvidenceData> {
  const sym = evidence.symbol.trim().toUpperCase();
  if (!sym) return evidence;
  try {
    const res = await fetch(compositeRouteForMode(mode), {
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

/**
 * @deprecated Use `enrichEvidenceWithComposite(evidence, mode)` directly so the call site
 * declares its trading mode. This alias is retained only to preserve back-compat for any
 * external consumers; new code MUST NOT call this function. It always hits the day engine
 * regardless of the row's mode, which is the exact regression this rename was intended to
 * prevent.
 */
export async function enrichEvidenceWithRealComposite(evidence: SignalEvidenceData): Promise<SignalEvidenceData> {
  return enrichEvidenceWithComposite(evidence, "day");
}
