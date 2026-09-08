/**
 * Pure helpers for Position desk fundamentals payload (`position_fundamentals`).
 */

export type PositionPillarId = "F1" | "F2" | "F3" | "F4" | "F5";

export type PositionPillarRow = {
  pillarId: PositionPillarId;
  label: string;
  score: number | null;
  verdict: string;
  status: string;
  reasoning: string;
  chips: string[];
  dataQuality: string;
};

export type PositionFundamentalsSummary = {
  status: string;
  score: number | null;
  verdict: string;
  reasoning: string;
  chips: string[];
  dataQuality: string;
  weakestPillarId: PositionPillarId | null;
  pillars: PositionPillarRow[];
};

const PILLAR_IDS: PositionPillarId[] = ["F1", "F2", "F3", "F4", "F5"];

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

function parsePillar(raw: unknown): PositionPillarRow | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pillarId = str(o.pillar_id).toUpperCase() as PositionPillarId;
  if (!PILLAR_IDS.includes(pillarId)) return null;
  return {
    pillarId,
    label: str(o.label) || pillarId,
    score: num(o.score),
    verdict: str(o.verdict) || "neutral",
    status: str(o.status) || "unavailable",
    reasoning: str(o.reasoning),
    chips: Array.isArray(o.chips) ? o.chips.map((c) => String(c)).filter(Boolean) : [],
    dataQuality: str(o.data_quality) || "unavailable"
  };
}

export function parsePositionFundamentals(
  body: Record<string, unknown> | null | undefined
): PositionFundamentalsSummary | null {
  const raw = body?.position_fundamentals;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pillarsRaw = Array.isArray(o.pillars) ? o.pillars : [];
  const pillars = pillarsRaw.map(parsePillar).filter((p): p is PositionPillarRow => p != null);
  const wp = str(o.weakest_pillar_id).toUpperCase();
  return {
    status: str(o.status) || "unavailable",
    score: num(o.score),
    verdict: str(o.verdict) || "neutral",
    reasoning: str(o.reasoning),
    chips: Array.isArray(o.chips) ? o.chips.map((c) => String(c)).filter(Boolean) : [],
    dataQuality: str(o.data_quality) || "unavailable",
    weakestPillarId: PILLAR_IDS.includes(wp as PositionPillarId) ? (wp as PositionPillarId) : null,
    pillars
  };
}

export function pillarVerdictTone(verdict: string): "bullish" | "bearish" | "neutral" | "muted" {
  const v = verdict.toLowerCase();
  if (v === "bullish") return "bullish";
  if (v === "bearish") return "bearish";
  if (v === "neutral") return "neutral";
  return "muted";
}
