import type { EvidenceLayer } from "@/lib/signal-evidence";

/** Layers on the Evidence card that must not show internal 0–100 scores or sub-scores. */
export const EVIDENCE_PLAIN_ENGLISH_LAYER_KEYS = new Set(["news", "macro", "internals"]);

const INTERNAL_SCORE_COPY_RE =
  /\/\s*100\b|\bscore\s*\d|\bNews score\b|\bMacro\s+\d|\bInternals\s+\d|momentum\s+\d|volatility\s+\d|event-?risk\s+\d|VIX component|blended sentiment|headline\s+[+-]?\d|analyst\s+[+-]?\d|participation\s+\d|breadth\s+\d/i;

export function layerCopyLooksInternal(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return INTERNAL_SCORE_COPY_RE.test(t);
}

export function filterInternalLayerScoreCopy(layerKey: string, points: string[]): string[] {
  if (!EVIDENCE_PLAIN_ENGLISH_LAYER_KEYS.has(layerKey)) return points;
  return points.map((p) => p.trim()).filter((p) => p.length > 0 && !layerCopyLooksInternal(p));
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
    const scope =
      n != null && n > 0
        ? `Headlines from ${n} recent article${n === 1 ? "" : "s"}`
        : "Recent headlines";
    if (layer.status === "Bullish") return `${scope} ${lean} for this setup.`;
    if (layer.status === "Bearish") return `${scope} ${lean} for this setup.`;
    if (layer.status === "Unavailable") return `${scope}; news coverage ${lean}.`;
    return `${scope} ${lean} — no strong catalyst either way.`;
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
    return risk ?? `Macro gauges ${lean} — mixed without a strong directional push.`;
  }

  if (layer.key === "internals") {
    if (layer.status === "Bullish") return `Market breadth and participation ${lean}.`;
    if (layer.status === "Bearish") return `Breadth and participation ${lean} — tape not confirming upside.`;
    if (layer.status === "Unavailable") return `Market internals ${lean}.`;
    return `Breadth and participation ${lean} — not a strong confirmation either way.`;
  }

  return layer.explanation;
}

export function evidenceLayerDisplayExplanation(layer: EvidenceLayer): string {
  if (EVIDENCE_PLAIN_ENGLISH_LAYER_KEYS.has(layer.key)) {
    return evidenceLayerPlainEnglishExplanation(layer);
  }
  return layer.explanation;
}
