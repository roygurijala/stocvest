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

export type ThesisConfidence = "high" | "medium" | "low";

export type ThesisBullet = {
  text: string;
  source: string; // "F1".."F5" or "layer:<name>"
  confidence: ThesisConfidence;
};

export type PositionThesisPacket = {
  symbol: string;
  verdict: string;
  bullCase: ThesisBullet[];
  bearCase: ThesisBullet[];
  openQuestions: ThesisBullet[];
  pillarSnapshotHash: string;
};

function parseBullet(raw: unknown): ThesisBullet | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = str(o.text);
  if (!text) return null;
  const conf = str(o.confidence).toLowerCase();
  return {
    text,
    source: str(o.source),
    confidence: conf === "high" || conf === "medium" || conf === "low" ? (conf as ThesisConfidence) : "low"
  };
}

function parseBullets(raw: unknown): ThesisBullet[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseBullet).filter((b): b is ThesisBullet => b != null);
}

/** Parse the server-built glass-box thesis packet (ADR-004 POS-AI-1/AI-2). */
export function parsePositionThesisPacket(
  body: Record<string, unknown> | null | undefined
): PositionThesisPacket | null {
  const raw = body?.position_thesis_packet;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const packet: PositionThesisPacket = {
    symbol: str(o.symbol),
    verdict: str(o.verdict) || "neutral",
    bullCase: parseBullets(o.bull_case),
    bearCase: parseBullets(o.bear_case),
    openQuestions: parseBullets(o.open_questions),
    pillarSnapshotHash: str(o.pillar_snapshot_hash)
  };
  if (!packet.bullCase.length && !packet.bearCase.length && !packet.openQuestions.length) {
    return null;
  }
  return packet;
}

export function pillarVerdictTone(verdict: string): "bullish" | "bearish" | "neutral" | "muted" {
  const v = verdict.toLowerCase();
  if (v === "bullish") return "bullish";
  if (v === "bearish") return "bearish";
  if (v === "neutral") return "neutral";
  return "muted";
}

/**
 * ADR-004 POS-AI-3 — condense the glass-box thesis packet into one bounded line for the
 * assistant page context (Bull / Bear / Open). Deterministic and source-faithful — it only
 * echoes packet bullet text, so the assistant can articulate the thesis without inventing.
 */
export function buildPositionThesisSummary(packet: PositionThesisPacket | null | undefined): string {
  if (!packet) return "";
  const join = (bullets: ThesisBullet[], n: number) =>
    bullets
      .slice(0, n)
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join("; ");
  const parts: string[] = [];
  const bull = join(packet.bullCase, 2);
  if (bull) parts.push(`Bull: ${bull}`);
  const bear = join(packet.bearCase, 2);
  if (bear) parts.push(`Bear: ${bear}`);
  const open = join(packet.openQuestions, 1);
  if (open) parts.push(`Open: ${open}`);
  return parts.join(" | ");
}
