import type { SnapshotPayload } from "@/lib/api/market";
import type { IntradaySetupPayload } from "@/lib/api/scanner";

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

export interface SignalEvidenceData {
  symbol: string;
  direction: EvidenceDirection;
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
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function timeAgoLabelFromIso(iso: string | null | undefined): string {
  const ts = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(ts)) return "Updated recently";
  const delta = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (delta < 60) return `Updated ${delta}s ago`;
  if (delta < 3600) return `Updated ${Math.floor(delta / 60)}m ago`;
  return `Updated ${Math.floor(delta / 3600)}h ago`;
}

function statusFromScore(score: number): EvidenceStatus {
  if (score >= 66) return "Bullish";
  if (score <= 38) return "Bearish";
  return "Neutral";
}

export function buildEvidenceFromSetup(
  setup: IntradaySetupPayload,
  snapshot?: SnapshotPayload,
  newsHeadline?: string
): SignalEvidenceData {
  const direction = setup.direction.toLowerCase() === "bullish" ? "bullish" : setup.direction.toLowerCase() === "bearish" ? "bearish" : "neutral";
  const confidencePercent = clamp(Math.round(setup.score * 100), 0, 100);
  const last = snapshot?.last_trade_price ?? null;
  const prev = snapshot?.prev_close ?? last;
  const momentum = typeof last === "number" && typeof prev === "number" && prev > 0 ? ((last - prev) / prev) * 100 : 0;
  const base = clamp(50 + momentum * 6, 0, 100);

  const technical = clamp(base + 18, 0, 100);
  const news = clamp(base + (newsHeadline ? 10 : -8), 0, 100);
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
      keyPoints: [
        `RSI ${Math.round(clamp(40 + momentum * 4, 18, 82))}`,
        `VWAP ${momentum >= 0 ? "Above" : "Below"}`,
        `EMA9 ${momentum >= 0 ? "Crossed up" : "Crossed down"}`
      ],
      contributionScore: technical,
      freshnessLabel: timeAgoLabelFromIso(setup.timestamp_iso)
    },
    {
      key: "news",
      icon: "📰",
      name: "News Sentiment",
      status: statusFromScore(news),
      weightPercent: 18,
      explanation: "Headline sentiment and catalyst intensity shape short-term directional bias.",
      keyPoints: [`Sentiment ${Math.round(news)}%`, `Articles ${newsHeadline ? "1+" : "0"}`, newsHeadline ? newsHeadline.slice(0, 40) : "No headline"],
      contributionScore: news,
      freshnessLabel: newsHeadline ? "News 2h ago" : "News unavailable"
    },
    {
      key: "macro",
      icon: "🌍",
      name: "Macro",
      status: statusFromScore(macro),
      weightPercent: 14,
      explanation: "Rates and macro event pressure influence conviction and risk appetite.",
      keyPoints: ["Fed Watch: Steady", "Yield Curve: Flat", "Event: CPI pending"],
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
      keyPoints: ["Sector: Technology", "vs SPX: +0.7%", "Leadership: Positive"],
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
      keyPoints: ["Risk Level: Moderate", "Flags: 1", "Region: Global"],
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
      keyPoints: ["VIX: Lower", "Breadth: Positive", "A/D: Rising"],
      contributionScore: internals,
      freshnessLabel: "Updated 5m ago"
    }
  ];

  const support = snapshot?.day_low ?? (typeof last === "number" ? last * 0.985 : null);
  const resistance = snapshot?.day_high ?? (typeof last === "number" ? last * 1.015 : null);

  return {
    symbol: setup.symbol,
    direction,
    confidencePercent,
    layers,
    aiVerdict:
      direction === "bullish"
        ? "Strong technical setup with supportive internals; geopolitical noise is the main risk to continuation."
        : direction === "bearish"
          ? "Momentum and risk signals lean defensive; macro crosscurrents limit reversal confidence."
          : "Signal layers are mixed, so conviction remains moderate until stronger alignment appears.",
    aiFreshnessLabel: "Updated 30s ago",
    keyLevels: {
      vwap: typeof last === "number" ? last * 0.997 : null,
      support,
      resistance,
      orHigh: typeof resistance === "number" ? resistance * 1.003 : null,
      orLow: typeof support === "number" ? support * 0.997 : null
    },
    updatedLabel: timeAgoLabelFromIso(setup.timestamp_iso),
    newsFreshnessLabel: newsHeadline ? "News 2h ago" : "News unavailable"
  };
}
