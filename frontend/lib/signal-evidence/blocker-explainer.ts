/**
 * Translates the terse, technical `primaryBlocker` string (e.g.
 * "Session move ~1.7× ATR — pace already extended") into a clear,
 * multi-sentence plain-English explanation a non-expert can act on, while
 * preserving the original technical phrasing for users who want it.
 *
 * The blocker can arrive from the API (`primary_blocker`) or be derived
 * client-side, so matching is keyword-based on the string itself rather than
 * on a fixed enum.
 */

export type BlockerExplanation = {
  /** Plain-English paragraphs. Always at least one. */
  plain: string[];
  /** The original technical phrasing, shown on demand. */
  technical: string;
};

function firstNumber(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1] : null;
}

export function explainBlocker(
  blocker: string,
  opts?: { mode?: "swing" | "day" }
): BlockerExplanation | null {
  const technical = (blocker || "").trim();
  if (!technical) return null;
  const lower = technical.toLowerCase();
  const mode = opts?.mode ?? "swing";

  // Session move vs. ATR — the stock has already run a large multiple of its
  // typical range, so a fresh entry is chasing an extended move.
  if (lower.includes("atr") || lower.includes("session move") || lower.includes("pace already")) {
    const x = firstNumber(technical, /(\d+(?:\.\d+)?)\s*×?\s*atr/i);
    const mult = x ? `about ${x}×` : "well over its usual";
    return {
      plain: [
        `The stock has already moved ${mult} its normal ${mode === "day" ? "intraday" : "daily"} range ${mode === "day" ? "so far today" : "during this move"}. ATR (Average True Range) is just a measure of how far it typically travels — so a reading this high means the bulk of the expected move has probably already happened.`,
        `Entering now means chasing: you'd get a worse price, need a wider stop, and have less room left to the target — which hurts your risk/reward. The cleaner play is to wait for the stock to pause, pull back, or settle into a tighter range before the next push.`
      ],
      technical
    };
  }

  // RSI / momentum overbought.
  if (lower.includes("rsi") || lower.includes("exhaustion") || lower.includes("overbought")) {
    const r = firstNumber(technical, /rsi\s+(\d+)/i);
    const zone = lower.includes("exhaustion") ? "exhaustion" : "overbought";
    return {
      plain: [
        `Momentum is running hot. RSI${r ? ` is at ${r}` : ""} — a momentum gauge where anything above 70 is considered overbought, and this reading is in ${zone} territory.`,
        `Moves this stretched usually need to cool off with a pause or a pullback before they can continue. Buying here risks getting in right before that reset, so it's better to wait for momentum to settle.`
      ],
      technical
    };
  }

  // Price stretched far above a moving average.
  if (lower.includes("sma50") || lower.includes("sma 50") || lower.includes("above sma") || lower.includes("vs mean")) {
    const pct = firstNumber(technical, /(\d+(?:\.\d+)?)\s*%/i);
    return {
      plain: [
        `Price is sitting ${pct ? `about ${pct}%` : "well"} above its 50-day average — a historically stretched distance. The 50-day average is a common "fair value" reference that price tends to drift back toward.`,
        `When a stock gets this far ahead of that average, the odds of a snap-back (mean reversion) rise. Waiting for price to come closer to the average usually offers a safer entry with a tighter stop.`
      ],
      technical
    };
  }

  // Layers / checks not yet in agreement.
  if (lower.includes("disagree") || lower.includes("checks still") || lower.includes("layer") || lower.includes("align")) {
    const names = technical.includes(":") ? technical.split(":").slice(1).join(":").trim() : "";
    return {
      plain: [
        `The signal layers don't agree on direction yet${names ? ` — ${names} still point the other way or are neutral` : ""}. Each layer checks a different angle: trend, momentum, volume, levels, and so on.`,
        `A high-confidence trade needs most of these pointing the same way at once. Until more of them line up, the evidence is mixed and the setup is still developing rather than ready to trade.`
      ],
      technical
    };
  }

  // Generic fallback — keep it honest and non-jargony.
  return {
    plain: [
      `This setup isn't ready to trade yet — one of the key conditions for a clean entry hasn't been met.`,
      `Acting before it clears raises the chance of a poor entry price or an early reversal, so it's better to wait for the blocker below to resolve.`
    ],
    technical
  };
}
