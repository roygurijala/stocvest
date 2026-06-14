import type { EvidenceLayer } from "@/lib/signal-evidence";

/** Layers on the Evidence card that must not show internal 0–100 scores or sub-scores. */
export const EVIDENCE_PLAIN_ENGLISH_LAYER_KEYS = new Set([
  "news",
  "macro",
  "internals",
  "sector"
]);

const INTERNAL_SCORE_COPY_RE =
  /\/\s*100\b|\bscore\s*\d|\bNews score\b|\bMacro\s+\d|\bInternals\s+\d|\bMarket Internals\s+\d|momentum\s+\d|volatility\s+\d|event-?risk\s+\d|VIX component|blended sentiment|headline\s+[+-]?\d|analyst\s+[+-]?\d|participation\s+\d|breadth\s+\d|sent_avg|model tilt|layer blend/i;

const EVIDENCE_SCORE_CHIP_RE = /layer blend|model tilt|sent_avg|~\d+\s*\/\s*100/i;

export function layerCopyLooksInternal(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return INTERNAL_SCORE_COPY_RE.test(t);
}

export function filterInternalLayerScoreCopy(layerKey: string, points: string[]): string[] {
  return points
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !layerCopyLooksInternal(p) && !EVIDENCE_SCORE_CHIP_RE.test(p));
}

function sectorScopeLabel(layer: EvidenceLayer): string | null {
  const display = layer.sector_display_name?.trim();
  const etf = layer.sector_etf?.trim().toUpperCase();
  if (display && etf) return `${display} (${etf})`;
  return display || etf || null;
}

function macroRiskPhrase(level: EvidenceLayer["macro_risk_level"]): string | null {
  if (level === "critical") return "High-impact macro event risk is in play.";
  if (level === "elevated") return "Macro event risk is elevated today.";
  if (level === "moderate") return "Macro risk is moderate.";
  if (level === "low") return "Macro risk is low.";
  return null;
}

function statusLeanPhrase(status: EvidenceLayer["status"]): string {
  if (status === "Bullish") return "leans bullish";
  if (status === "Bearish") return "leans bearish";
  if (status === "As of close") return "reflects the last close-state read";
  if (status === "Unavailable") return "is unavailable for this read";
  return "is neutral";
}

/**
 * User-facing layer summary for the Evidence card — verdict and context only.
 */
export function evidenceLayerPlainEnglishExplanation(layer: EvidenceLayer): string {
  const lean = statusLeanPhrase(layer.status);

  if (layer.key === "news") {
    const n = layer.articles_count;
    if (layer.news_data_state === "degraded") {
      return "News feed unavailable — excluded from composite scoring.";
    }
    if (layer.news_data_state === "supplementary_context") {
      return "Supplementary AI context (thin coverage) — not a structured headline feed.";
    }
    const scope =
      n != null && n > 0
        ? `Headlines from ${n} recent article${n === 1 ? "" : "s"}`
        : "Recent headlines";
    if (layer.status === "Bullish") return `${scope} ${lean} for this setup.`;
    if (layer.status === "Bearish") return `${scope} ${lean} for this setup.`;
    if (layer.status === "Unavailable") return `${scope}; news coverage ${lean}.`;
    return "News coverage is neutral — no strong catalyst either way.";
  }

  if (layer.key === "macro") {
    const risk = macroRiskPhrase(layer.macro_risk_level);
    if (layer.status === "Bullish") {
      return risk ? `Macro backdrop ${lean}. ${risk}` : `Macro backdrop ${lean} for risk assets.`;
    }
    if (layer.status === "Bearish") {
      return risk ? `Macro backdrop ${lean}. ${risk}` : `Macro backdrop ${lean} for this direction.`;
    }
    if (layer.status === "Unavailable") return `Macro gauges ${lean}.`;
    return risk ?? "Macro backdrop is neutral — mixed without a strong directional push.";
  }

  if (layer.key === "internals") {
    if (layer.status === "Bullish") return `Market breadth and participation ${lean}.`;
    if (layer.status === "Bearish") return `Breadth and participation ${lean} — tape not confirming upside.`;
    if (layer.status === "Unavailable") return `Market internals ${lean}.`;
    return `Breadth and participation ${lean} — not a strong confirmation either way.`;
  }

  if (layer.key === "sector") {
    const scope = sectorScopeLabel(layer);
    const prefix = scope ? `${scope} sector` : "Sector";
    if (layer.status === "Bullish") return `${prefix} is leading versus the broad market.`;
    if (layer.status === "Bearish") return `${prefix} is lagging — relative strength does not support this setup.`;
    if (layer.status === "Unavailable") return `${prefix} coverage ${lean}.`;
    return `${prefix} participation is mixed versus the broad market.`;
  }

  return layer.explanation;
}

export function evidenceLayerDisplayExplanation(layer: EvidenceLayer): string {
  if (EVIDENCE_PLAIN_ENGLISH_LAYER_KEYS.has(layer.key)) {
    return evidenceLayerPlainEnglishExplanation(layer);
  }
  if (layer.key === "geopolitical" && layerCopyLooksInternal(layer.explanation)) {
    return "Geopolitical risk is monitored — no strong directional push on this read.";
  }
  return layer.explanation;
}

/** Italic layer subtitle on the Evidence card — never internal score strings. */
export function evidenceLayerInsightText(
  layer: EvidenceLayer,
  causalBecause?: string | null
): string {
  const causal = causalBecause?.trim();
  if (causal && !layerCopyLooksInternal(causal)) {
    return causal.length > 88 ? `${causal.slice(0, 85)}…` : causal;
  }
  return evidenceLayerDisplayExplanation(layer);
}
