import type { VolatilityCategory } from "@/lib/market-context/derivations";

export type MarketContextStructuredExplain = {
  why: string[];
  result: string;
  impact: string[];
  advanced?: string;
};

function formatSessionPct(pct: number | null): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function sessionStrengthPhrase(spyPct: number | null, qqqPct: number | null): "strong" | "weak" | "mixed" | "unknown" {
  if (spyPct == null || qqqPct == null) return "unknown";
  const spyUp = spyPct > 0.05;
  const qqqUp = qqqPct > 0.05;
  const spyDown = spyPct < -0.05;
  const qqqDown = qqqPct < -0.05;
  if (spyUp && qqqUp) return "strong";
  if (spyDown && qqqDown) return "weak";
  return "mixed";
}

export function buildRegimeStructuredExplain(opts: {
  regimeLabel: string;
  spyPct: number | null;
  qqqPct: number | null;
  regimePriceBreadthOnly: boolean;
  vixPulseOk: boolean;
}): MarketContextStructuredExplain {
  const label = opts.regimeLabel.trim();
  const r = label.toLowerCase();
  const spy = formatSessionPct(opts.spyPct);
  const qqq = formatSessionPct(opts.qqqPct);
  const strength = sessionStrengthPhrase(opts.spyPct, opts.qqqPct);

  const why: string[] = [];
  if (spy && qqq) {
    if (strength === "strong") {
      why.push("SPY and QQQ are both strong today");
      why.push("Intraday momentum is positive");
    } else if (strength === "weak") {
      why.push("SPY and QQQ are both weak today");
      why.push("Intraday momentum is negative");
    } else {
      why.push(`SPY ${spy} and QQQ ${qqq} today — mixed intraday leadership`);
      why.push("Benchmarks are not moving in the same direction");
    }
  } else {
    why.push("Session tape for SPY/QQQ is incomplete this load");
  }
  if (opts.regimePriceBreadthOnly || !opts.vixPulseOk) {
    why.push("VIX is unavailable — regime uses price and breadth only");
  }

  let impact: string[];
  if (r.includes("bull")) {
    impact = ["Long setups favored", "Signals allowed when structure aligns"];
  } else if (r.includes("bear")) {
    impact = ["Defensive posture — swing rows often suppressed", "Favor confirmation before acting on longs"];
  } else {
    impact = ["Mixed tape — desk filters matter more than regime alone", "Wait for clearer index alignment"];
  }

  return {
    why,
    result: `Regime is ${label}`,
    impact,
    advanced:
      "Bullish when SPY > +0.2% and QQQ > +0.15% on the session tape; Bearish when SPY < −0.2% or QQQ < −0.25%; otherwise Neutral."
  };
}

export function buildVolatilityStructuredExplain(opts: {
  category: VolatilityCategory;
  vixPulseOk: boolean;
  regimePriceBreadthOnly: boolean;
}): MarketContextStructuredExplain {
  if (opts.category === "Unknown" || !opts.vixPulseOk) {
    return {
      why: [
        "VIX feed is unavailable this load",
        "Volatility band is not confirmed — read range from price action and breadth instead"
      ],
      result: "Volatility is Unknown (using breadth + price only)",
      impact: [
        "Treat range reads as provisional",
        "Regime and desk gates still use index session % and breadth"
      ],
      advanced: "When VIX returns: High at VIX ≥ 22 or session change ≥ +5%; Low at VIX ≤ 13 or change ≤ −5%."
    };
  }

  const band =
    opts.category === "Expanding" ? "High" : opts.category === "Compressed" || opts.category === "Contained" ? "Low" : "Unknown";

  const why =
    opts.category === "Expanding"
      ? ["VIX level or session change shows expanding ranges", "Expect wider intraday swings vs recent sessions"]
      : opts.category === "Compressed"
        ? ["VIX is low or compressing on the session", "Ranges are tighter than recent sessions"]
        : ["VIX sits in a mid band with quiet session change", "Daily ranges look stable vs prior sessions"];

  return {
    why,
    result: `Volatility band is ${band}`,
    impact:
      opts.category === "Expanding"
        ? ["Size and stops may need more room", "Breakouts can extend — confirmation still required"]
        : ["Contained ranges — breakouts may lack follow-through", "Desk gates unchanged"],
    advanced:
      "High when VIX ≥ 22 or session change ≥ +5%; Low when VIX ≤ 13 or change ≤ −5%; otherwise Low (contained)."
  };
}

export type MarketContextSessionToday = {
  label: string;
  items: Array<{ symbol: string; formattedPct: string; tone: "bullish" | "bearish" | "muted" }>;
};

export function buildSessionTodayLine(spyPct: number | null, qqqPct: number | null): MarketContextSessionToday {
  const items: MarketContextSessionToday["items"] = [];
  for (const [symbol, pct] of [
    ["SPY", spyPct],
    ["QQQ", qqqPct]
  ] as const) {
    const formatted = formatSessionPct(pct);
    if (!formatted) continue;
    const tone = pct != null && pct > 0.05 ? "bullish" : pct != null && pct < -0.05 ? "bearish" : "muted";
    items.push({ symbol, formattedPct: formatted, tone });
  }
  return { label: "Today", items };
}
