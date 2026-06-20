/**
 * Pure helpers for Trading Room deep-dive copy and scenario geometry logic.
 */

import type { FeedBias, FeedState } from "@/lib/dashboard/trading-room/feed-model";
import type { TradeDecisionState } from "@/lib/signal-evidence/trade-decision";
import type { SignalEvidenceInsight } from "@/lib/signal-evidence/wire-types";
import {
  countLayerAlignment,
  layerRowEligibleForAlignmentCount,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";

export type TradeDirection = "long" | "short" | "neutral";
export type EntryZonePosition = "inside" | "above" | "below";

export function setupBiasToTradeDirection(bias: SignalsSetupBias): TradeDirection {
  if (bias === "Bullish") return "long";
  if (bias === "Bearish") return "short";
  return "neutral";
}

export function feedBiasToTradeDirection(bias: FeedBias): TradeDirection {
  if (bias === "bull") return "long";
  if (bias === "bear") return "short";
  return "neutral";
}

const FEED_STATE_LABEL: Record<FeedState, string> = {
  actionable: "Actionable",
  near: "Near",
  potential: "Potential",
  cooling: "Cooling"
};

const DECISION_STATE_LABEL: Record<TradeDecisionState, string> = {
  actionable: "Actionable",
  monitor: "Monitor",
  blocked: "Blocked"
};

/**
 * Live composite decision wins over feed/watchlist maturation state.
 * Neutral composites are always monitor on the API — never actionable.
 */
export function resolveDeepDiveVerdictLabel(
  feedState: FeedState,
  apiDecisionState: TradeDecisionState | null,
  hasComposite: boolean
): string {
  if (hasComposite && apiDecisionState) return DECISION_STATE_LABEL[apiDecisionState];
  return FEED_STATE_LABEL[feedState];
}

export type DeepDiveVerdictTone = "bullish" | "caution" | "bearish" | "muted";

export function resolveDeepDiveVerdictTone(
  feedState: FeedState,
  apiDecisionState: TradeDecisionState | null,
  hasComposite: boolean
): DeepDiveVerdictTone {
  if (hasComposite && apiDecisionState) {
    if (apiDecisionState === "actionable") return "bullish";
    if (apiDecisionState === "monitor") return "caution";
    return "bearish";
  }
  if (feedState === "actionable") return "bullish";
  if (feedState === "near") return "caution";
  if (feedState === "cooling") return "bearish";
  return "muted";
}

/** Prefer composite desk bias when loaded; fall back to feed card bias. */
export function resolveDeepDiveDirection(
  setupBias: SignalsSetupBias,
  hasComposite: boolean,
  feedBias: FeedBias
): { direction: TradeDirection; bannerLabel: "LONG" | "SHORT" | "NEUTRAL" } {
  const dir = hasComposite ? setupBiasToTradeDirection(setupBias) : feedBiasToTradeDirection(feedBias);
  const bannerLabel = dir === "long" ? "LONG" : dir === "short" ? "SHORT" : "NEUTRAL";
  return { direction: dir, bannerLabel };
}

export function resolveEntryZonePosition(
  currentPrice: number,
  entryLow: number,
  entryHigh: number
): EntryZonePosition {
  if (currentPrice >= entryLow && currentPrice <= entryHigh) return "inside";
  return currentPrice > entryHigh ? "above" : "below";
}

/** Price-axis percent (low → 0%, high → 100%) for geometry markers. */
export function scenarioPriceAxisPercent(
  price: number,
  trackMin: number,
  trackMax: number
): number {
  const span = trackMax - trackMin;
  if (span <= 1e-9) return 50;
  return Math.max(0, Math.min(100, ((price - trackMin) / span) * 100));
}

export function scenarioTrackBounds(levels: number[]): { trackMin: number; trackMax: number } {
  const finite = levels.filter((n) => Number.isFinite(n));
  if (finite.length === 0) return { trackMin: 0, trackMax: 1 };
  return { trackMin: Math.min(...finite), trackMax: Math.max(...finite) };
}

export function buildBriefAlignmentLine(bias: SignalsSetupBias, rows: SignalsLayerRowInput[]): string {
  const { aligned, total } = countLayerAlignment(rows, bias);
  if (bias === "Neutral") {
    return `${aligned} of ${total} layers read neutral or mixed — no dominant desk bias.`;
  }
  const thesis = bias.toLowerCase();
  const targetStatus = bias === "Bullish" ? "Bullish" : "Bearish";
  const confirming = rows
    .filter((r) => layerRowEligibleForAlignmentCount(r) && r.status === targetStatus)
    .map((r) => r.name);
  const neutral = rows
    .filter((r) => layerRowEligibleForAlignmentCount(r) && r.status === "Neutral")
    .map((r) => r.name);
  if (confirming.length === 0) {
    return `${aligned} of ${total} layers currently carry a directional read.`;
  }
  let line = `${aligned} of ${total} layers confirm the ${thesis} thesis: ${confirming.slice(0, 4).join(", ")}`;
  if (neutral.length > 0) {
    const names = neutral.slice(0, 2).join(", ");
    line += `. ${names} ${neutral.length === 1 ? "is" : "are"} neutral — not contradicting`;
  }
  return `${line}.`;
}

export function buildBriefMetaLine(input: {
  bias: SignalsSetupBias;
  rows: SignalsLayerRowInput[];
  timingFlagCount: number;
}): string {
  const { aligned, total } = countLayerAlignment(input.rows, input.bias);
  const layersPart = `${aligned} of ${total} layers confirm${input.bias === "Neutral" ? " consistency" : ""}`;
  const macroRow = input.rows.find((r) => r.key === "macro");
  const macroPart = macroRow ? `Macro ${macroRow.status?.toLowerCase() ?? "n/a"}` : null;
  const flagsPart =
    input.timingFlagCount > 0
      ? `${input.timingFlagCount} timing caution${input.timingFlagCount === 1 ? "" : "s"}`
      : null;
  return [layersPart, macroPart, flagsPart].filter(Boolean).join(" · ");
}

export function buildEntryZoneRrWarning(input: {
  position: EntryZonePosition;
  currentPrice: number;
  entryLow: number;
  entryHigh: number;
  currentRr: number | null;
  zoneEdgeRr: number | null;
  chosenLabel: string;
  minRr: number;
}): string[] {
  if (input.position === "inside") return [];
  const zone = `$${input.entryLow.toFixed(2)}–$${input.entryHigh.toFixed(2)}`;
  const gate = `${input.minRr.toFixed(1)}:1`;
  const lines: string[] = [
    `Current price ($${input.currentPrice.toFixed(2)}) is ${input.position === "above" ? "above" : "below"} the entry zone (${zone}).`
  ];
  if (input.currentRr != null) {
    const clears = input.currentRr >= input.minRr;
    lines.push(
      `R/R from current price: ${input.currentRr.toFixed(1)}:1 — ${clears ? "clears" : "does not clear"} the ${gate} gate.`
    );
  }
  if (input.zoneEdgeRr != null) {
    lines.push(
      `R/R from entry zone ${input.position === "above" ? "top" : "bottom"} → ${input.chosenLabel}: ${input.zoneEdgeRr.toFixed(1)}:1 — ${input.zoneEdgeRr >= input.minRr ? "clears gate if zone is reached" : "still below gate at zone edge"}.`
    );
  }
  lines.push("Do not enter at current price — wait for price to reach the entry zone.");
  return lines;
}

/**
 * Stable per-input hash (FNV-1a). Lets the brief pick a phrasing variant that is
 * deterministic for a given symbol/state — so two tickers read differently, but
 * the same ticker always renders the same copy (cache-stable and unit-testable).
 */
function stableVariant(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function openerVariant(
  v: number,
  sym: string,
  dir: string,
  desk: string,
  trend: string,
  regimePart: string
): string {
  const t = trend ? `${trend} read` : "developing read";
  const options = [
    `${sym} is reading ${dir} on the ${desk} — ${t}${regimePart}.`,
    `On the ${desk}, ${sym} maps to a ${dir} setup: ${t}${regimePart}.`,
    `${sym} sets up ${dir} for the ${desk} — ${t}${regimePart}.`,
    `Right now ${sym} leans ${dir} on the ${desk}; ${t}${regimePart}.`,
    `${sym} is shaping a ${dir} ${desk} setup — ${t}${regimePart}.`
  ];
  return options[v % options.length];
}

function noInsightOpener(v: number, sym: string, dir: string, desk: string): string {
  const options = [
    `${sym} is setting up ${dir} on the ${desk}.`,
    `On the ${desk}, ${sym} is shaping a ${dir} setup.`,
    `${sym} maps to a ${dir} read on the ${desk}.`
  ];
  return options[v % options.length];
}

function truncateCatalyst(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 110 ? `${clean.slice(0, 107)}…` : clean;
}

export function buildRichBrief(input: {
  symbol: string;
  direction: TradeDirection;
  insight: SignalEvidenceInsight | null;
  layerRows: SignalsLayerRowInput[];
  setupBias: SignalsSetupBias;
  pageDecisionState: string | null;
  causalSummary: string | null;
  causalChainLabel: string | null;
  setupJudgment: {
    tradeability: { label: string; flags: { label: string }[] };
    primaryBlocker: string | null;
    watchFor: string | null;
  } | null;
  currentRr: number | null;
  activeLane: "day" | "swing";
  deskMinRr: number;
  verdictFallback: string;
}): string {
  const dir =
    input.direction === "long" ? "long" : input.direction === "short" ? "short" : "two-sided";
  const desk = input.activeLane === "day" ? "day desk" : "swing desk";
  const variant = stableVariant(`${input.symbol}|${input.setupBias}|${input.pageDecisionState ?? ""}`);

  let s1: string;
  let s1b = "";
  if (input.insight) {
    const trend = `${input.insight.trend_strength.toLowerCase()} ${input.insight.trend_direction.toLowerCase()}`.trim();
    const regime = (input.insight.market_regime || "").trim().toLowerCase();
    const regimePart = regime && regime !== "unknown" ? ` against a ${regime} tape` : "";
    s1 = openerVariant(variant, input.symbol, dir, desk, trend, regimePart);

    // Name the actual signals doing the work so the read is specific, not generic.
    const conf = input.insight.confirming_signals ?? [];
    const confl = input.insight.conflicting_signals ?? [];
    const lead = conf[0]?.label?.trim();
    const leadAgainst = confl[0]?.label?.trim();
    const confPart = conf.length
      ? `${conf.length} signal${conf.length === 1 ? "" : "s"} line up${lead ? ` (led by ${lead})` : ""}`
      : "";
    const conflPart = confl.length
      ? `${confl.length} push${confl.length === 1 ? "es" : ""} back${leadAgainst ? ` (${leadAgainst})` : ""}`
      : "";
    s1b = [confPart, conflPart].filter(Boolean).join(", while ");
    if (s1b) s1b = `${s1b.charAt(0).toUpperCase()}${s1b.slice(1)}.`;
  } else {
    s1 = noInsightOpener(variant, input.symbol, dir, desk);
  }

  const s2 = buildBriefAlignmentLine(input.setupBias, input.layerRows);
  const s3 = input.causalSummary?.trim() ?? "";
  const s4 =
    input.causalChainLabel && input.causalChainLabel.length < 80
      ? `Tailwind chain: ${input.causalChainLabel}.`
      : "";

  // Surface the freshest catalyst by name — what's actually moving the ticker.
  let sCat = "";
  const catalysts = input.insight?.catalysts ?? [];
  const topCatalyst = catalysts.find((c) => (c?.text || "").trim().length > 0);
  if (topCatalyst) {
    const sent = (topCatalyst.sentiment || "").trim().toLowerCase();
    const sentPart = sent && sent !== "neutral" ? ` (${sent} catalyst)` : "";
    const more = catalysts.length > 1 ? ` +${catalysts.length - 1} more` : "";
    sCat = `News in play: ${truncateCatalyst(topCatalyst.text)}${sentPart}${more}.`;
  }

  let s5 = "";
  if (input.setupJudgment) {
    const timing = input.setupJudgment.tradeability.label;
    const blocker = input.setupJudgment.primaryBlocker;
    if (input.pageDecisionState === "actionable" && !blocker) {
      s5 = `${timing} — all gates cleared for this trade.`;
    } else if (blocker) {
      s5 = `${timing}. Primary check: ${blocker}`;
    } else {
      s5 = `${timing}.`;
    }
  }

  let s6 = "";
  if (input.currentRr != null && input.currentRr > 0) {
    const gateLabel = `${input.deskMinRr.toFixed(1)}:1`;
    const rrStr =
      input.currentRr >= input.deskMinRr
        ? `Risk/reward from current price is ${input.currentRr.toFixed(1)}:1, clearing the ${gateLabel} gate`
        : `Risk/reward from current price is ${input.currentRr.toFixed(1)}:1 — below the ${gateLabel} threshold`;
    const watch = input.setupJudgment?.watchFor;
    s6 = watch ? `${rrStr}. ${watch}` : `${rrStr}.`;
  } else if (input.setupJudgment?.watchFor) {
    s6 = input.setupJudgment.watchFor;
  }

  if (!s2 && !s3 && !s5) return input.verdictFallback || s1;
  return [s1, s1b, s2, s3, s4, sCat, s5, s6].filter(Boolean).join(" ");
}
