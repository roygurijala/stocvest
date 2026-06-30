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

/** Price-axis bounds for the scenario geometry bar (stop → farthest target). */
export function scenarioGeometryTrackBounds(input: {
  stopPrice: number;
  target1?: number | null;
  target2?: number | null;
  entryLow: number;
  entryHigh: number;
  currentPrice: number;
}): { trackMin: number; trackMax: number } {
  const levels = [
    input.stopPrice,
    input.entryLow,
    input.entryHigh,
    input.currentPrice,
    input.target1,
    input.target2
  ].filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return scenarioTrackBounds(levels);
}

/** Outermost profit target on the low→high price axis (both T1 and T2 when present). */
export function scenarioFarthestTargetPrice(input: {
  isShort: boolean;
  target1?: number | null;
  target2?: number | null;
  fallbackTarget: number;
}): number {
  const levels = [input.target1, input.target2, input.fallbackTarget].filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n)
  );
  if (levels.length === 0) return input.fallbackTarget;
  return input.isShort ? Math.min(...levels) : Math.max(...levels);
}

/**
 * Orientation for the scenario geometry bar. The entry-zone band and current marker are
 * positioned on a value-based low→high axis, so the Stop/Target corner labels (and the
 * profit/loss copy) must follow the *actual* level geometry, not the headline bias alone:
 * whichever of stop/target is the higher price is the right ("up") end. Falls back to the
 * supplied bias only when stop and target coincide (or are non-finite). This keeps the bar
 * self-consistent even when an upstream stop/target pair is inverted relative to the bias.
 */
export function scenarioGeometryIsShort(
  stopPrice: number,
  targetPrice: number,
  biasIsShort: boolean
): boolean {
  if (
    !Number.isFinite(stopPrice) ||
    !Number.isFinite(targetPrice) ||
    stopPrice === targetPrice
  ) {
    return biasIsShort;
  }
  return stopPrice > targetPrice;
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

function normalizeBriefClause(s: string): string {
  return s
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip any clause already stated in `blocker` from the watch-for line so the brief
 * never repeats the same fact twice — e.g. the primary blocker "Session move ~3.9× ATR
 * — late for fresh entry" and a watch-for line that re-embeds that same phrase (often
 * with different casing, "…3.9× atr…"). Clauses are the em-dash / spaced-hyphen segments.
 */
export function dedupeWatchForAgainstBlocker(watch: string, blocker: string | null): string {
  const w = (watch || "").trim();
  if (!w || !blocker) return w;
  const blockerClauses = new Set(
    blocker.split(/\s+[—–-]\s+/).map(normalizeBriefClause).filter(Boolean)
  );
  const kept = w
    .split(/\s+[—–-]\s+/)
    .filter((seg) => !blockerClauses.has(normalizeBriefClause(seg)));
  return kept.join(" — ").trim();
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

  const blocker = input.setupJudgment?.primaryBlocker ?? null;
  let s5 = "";
  if (input.setupJudgment) {
    const timing = input.setupJudgment.tradeability.label;
    if (input.pageDecisionState === "actionable" && !blocker) {
      s5 = `${timing} — all gates cleared for this trade.`;
    } else if (blocker) {
      s5 = `${timing}. Primary check: ${blocker}`;
    } else {
      s5 = `${timing}.`;
    }
  }

  // Never repeat the primary blocker inside the closing watch-for line.
  const watch = dedupeWatchForAgainstBlocker(input.setupJudgment?.watchFor ?? "", blocker);
  let s6 = "";
  if (input.currentRr != null && input.currentRr > 0) {
    const gateLabel = `${input.deskMinRr.toFixed(1)}:1`;
    const rrStr =
      input.currentRr >= input.deskMinRr
        ? `Risk/reward from current price is ${input.currentRr.toFixed(1)}:1, clearing the ${gateLabel} gate`
        : `Risk/reward from current price is ${input.currentRr.toFixed(1)}:1 — below the ${gateLabel} threshold`;
    s6 = watch ? `${rrStr}. ${watch}` : `${rrStr}.`;
  } else if (watch) {
    s6 = watch;
  }

  if (!s2 && !s3 && !s5) return input.verdictFallback || s1;
  return [s1, s1b, s2, s3, s4, sCat, s5, s6].filter(Boolean).join(" ");
}

/**
 * Plain-English summary — the jargon-free default read (2-3 short sentences) shown above
 * the detailed/technical brief. Deliberately avoids trading shorthand (EMA, VWAP, ATR, R/R,
 * "layers", "thesis", "gates") and translates the structured judgment into everyday words:
 * what the idea is, how much agrees with it, and the one thing to do about it. The detailed
 * `buildRichBrief` text remains available behind a "details" toggle for power users.
 */
export function buildPlainSummary(input: {
  symbol: string;
  direction: TradeDirection;
  activeLane: "day" | "swing";
  layersAligned: number | null;
  layersTotal: number | null;
  decisionState: string | null;
  primaryBlocker: string | null;
  currentRr: number | null;
  deskMinRr: number;
  fallback: string;
}): string {
  const sym = input.symbol.trim().toUpperCase();
  if (!sym) return input.fallback;
  const desk = input.activeLane === "day" ? "day-trading" : "swing";
  const dirPhrase =
    input.direction === "long"
      ? "a buy (long) idea"
      : input.direction === "short"
        ? "a short idea (a bet the price falls)"
        : "a wait-and-see idea";

  // 1) What it is + how close it is to being tradable, in plain words.
  const state = (input.decisionState || "").trim().toLowerCase();
  let stance: string;
  if (state === "actionable") {
    stance = `${sym} looks like ${dirPhrase} on the ${desk} desk, and it's ready to trade now.`;
  } else if (state === "blocked" || state === "invalidated") {
    stance = `${sym} looks like ${dirPhrase} on the ${desk} desk, but it isn't tradable right now.`;
  } else {
    stance = `${sym} is shaping up as ${dirPhrase} on the ${desk} desk, but it still needs to develop.`;
  }

  // 2) How much of the analysis agrees, without naming the layers.
  let agree = "";
  const a = input.layersAligned;
  const t = input.layersTotal;
  if (a != null && t != null && t > 0 && a >= 0) {
    if (a <= Math.ceil(t / 3)) {
      agree = `Only ${a} of the ${t} checks back that read so far.`;
    } else if (a >= t - 1) {
      agree = `Almost everything we check (${a} of ${t}) backs that read.`;
    } else {
      agree = `${a} of the ${t} checks back that read.`;
    }
  }

  // 3) The single most useful "so what" — translate the blocker, else the reward math.
  const blocker = (input.primaryBlocker || "").toLowerCase();
  let soWhat = "";
  if (blocker.includes("atr") || blocker.includes("session move") || blocker.includes("late")) {
    soWhat = "It has already moved a lot today, so it's late to jump in — better to wait for a pullback.";
  } else if (blocker.includes("extended") || blocker.includes("above sma") || blocker.includes("stretched") || blocker.includes("exhaustion")) {
    soWhat = "It looks stretched here, so it's worth waiting for the move to cool off before entering.";
  } else if (blocker.includes("disagree") || blocker.includes("align")) {
    soWhat = "The signals don't fully agree yet, so it's better to wait for them to line up.";
  } else if (input.currentRr != null && input.currentRr > 0) {
    soWhat =
      input.currentRr >= input.deskMinRr
        ? `If it does set up, the potential reward is roughly ${input.currentRr.toFixed(1)}× the risk.`
        : `The potential reward is only about ${input.currentRr.toFixed(1)}× the risk right now — thinner than we'd want.`;
  } else if (state !== "actionable") {
    soWhat = "Wait for a cleaner entry before acting.";
  }

  const out = [stance, agree, soWhat].filter(Boolean).join(" ");
  return out || input.fallback;
}
