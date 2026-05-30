/**
 * Curated landing product-demo cards — aligned with `demo-verdicts.ts` and Signals Setup read IA.
 * Illustrative static copy; not live market data.
 */

import { LANDING_DEMO_VERDICTS } from "@/lib/landing/demo-verdicts";

export type LandingDemoLayerPolarity = "supportive" | "opposing" | "neutral";

export type LandingDemoLayer = {
  label: string;
  score: number;
  polarity: LandingDemoLayerPolarity;
};

export type LandingEngineDemo = {
  symbol: string;
  desk: "swing" | "day";
  metaLine: string;
  bias: "Bullish" | "Bearish" | "Neutral";
  alignmentLabel: string;
  aligned: number;
  total: number;
  execution: string;
  actionable: boolean;
  /** Trade readiness 0–100 — secondary to bias / alignment / execution. */
  readinessScore?: number;
  layers: LandingDemoLayer[];
  /** Evidence-style structural geo note (geopolitical layer only). */
  geoCallout?: { title: string; body: string };
  narrative: string;
  levelsLine?: string;
  /** Shown when execution is gated — mirrors Setup read “why not”. */
  blockerLine?: string;
  convictionLine?: string;
};

const NVDA = LANDING_DEMO_VERDICTS.NVDA;
const MSFT = LANDING_DEMO_VERDICTS.MSFT;

export const LANDING_ENGINE_SWING_DEMO: LandingEngineDemo = {
  symbol: NVDA.symbol,
  desk: "swing",
  metaLine: "Swing desk · Maturation forming · Updated just now",
  bias: NVDA.bias,
  alignmentLabel: NVDA.alignmentLabel,
  aligned: NVDA.alignedLayers,
  total: NVDA.totalLayers,
  execution: "Actionable",
  actionable: true,
  readinessScore: 84,
  layers: [
    { label: "Technical", score: 91, polarity: "supportive" },
    { label: "News", score: 78, polarity: "supportive" },
    { label: "Macro", score: 68, polarity: "supportive" },
    { label: "Sector", score: 87, polarity: "supportive" },
    { label: "Geopolitical", score: 32, polarity: "opposing" },
    { label: "Market Internals", score: 88, polarity: "supportive" }
  ],
  geoCallout: {
    title: "Structural exposure",
    body:
      "Semiconductors carry 1.8× weight on US-China trade tension. Energy names would score ~0.4× on the same headline — same news, different sector exposure."
  },
  narrative:
    "Strong daily structure and earnings momentum. Geo headwind partially offsets the bullish thesis — watch trade-policy headlines this week.",
  levelsLine: "Entry $112–$118 · Stop $108 · R/R 2.8:1",
  convictionLine: "A+ · High conviction on reference levels"
};

export const LANDING_ENGINE_DAY_DEMO: LandingEngineDemo = {
  symbol: MSFT.symbol,
  desk: "day",
  metaLine: "Day desk · 9:38 AM ET · Confluence alert",
  bias: MSFT.bias,
  alignmentLabel: MSFT.alignmentLabel,
  aligned: MSFT.alignedLayers,
  total: MSFT.totalLayers,
  execution: "Monitor only",
  actionable: false,
  readinessScore: 79,
  layers: [
    { label: "Technical", score: 88, polarity: "supportive" },
    { label: "News", score: 82, polarity: "supportive" },
    { label: "Macro", score: 71, polarity: "supportive" },
    { label: "Sector", score: 85, polarity: "supportive" },
    { label: "Geopolitical", score: 54, polarity: "neutral" },
    { label: "Market Internals", score: 76, polarity: "supportive" }
  ],
  narrative:
    "ORB structure and sector leadership look fine, but session gates are closed — alignment alone does not authorize a day chase.",
  blockerLine: MSFT.whyNot[0],
  convictionLine: "Developing · wait for confirmation"
};

export function landingEngineDemoForMode(mode: "swing" | "day"): LandingEngineDemo {
  return mode === "day" ? LANDING_ENGINE_DAY_DEMO : LANDING_ENGINE_SWING_DEMO;
}
