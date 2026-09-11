/**
 * Pure helpers for Position desk fundamentals payload (`position_fundamentals`).
 */

import type { TickerAnalystPanel, TickerAnalystRatingRow } from "@/lib/api/ticker-news-panel";

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
  /** False when there are no scored F1-F5 pillars — do NOT claim a fundamentals verdict. */
  fundamentalsCovered: boolean;
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
    pillarSnapshotHash: str(o.pillar_snapshot_hash),
    fundamentalsCovered: o.fundamentals_covered !== false
  };
  if (!packet.bullCase.length && !packet.bearCase.length && !packet.openQuestions.length) {
    return null;
  }
  return packet;
}

export type PositionHolderStance = "defensive" | "caution" | "constructive";

export type PositionHolderRead = {
  stance: PositionHolderStance;
  headline: string;
  actions: string[];
  context: string[];
  disclaimer: string;
};

const HOLDER_STANCES: PositionHolderStance[] = ["defensive", "caution", "constructive"];

/**
 * Parse the ship-dark owner-oriented holder read (`position_holder_read`). Present only when
 * the backend flag is on; returns null otherwise so the UI renders nothing.
 */
export function parsePositionHolderRead(
  body: Record<string, unknown> | null | undefined
): PositionHolderRead | null {
  const raw = body?.position_holder_read;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stance = str(o.stance).toLowerCase() as PositionHolderStance;
  if (!HOLDER_STANCES.includes(stance)) return null;
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : [];
  const actions = strList(o.actions);
  if (!actions.length) return null;
  return {
    stance,
    headline: str(o.headline),
    actions,
    context: strList(o.context),
    disclaimer: str(o.disclaimer)
  };
}

/**
 * POS-AI-13 (display-only) — parse the ship-dark Long Term analyst panel
 * (`position_analyst`, same shape as the ticker news panel's analyst block).
 * Present only when the backend flag is on; returns null otherwise so the UI
 * renders nothing. This is DISPLAY-only — it never affects the composite score.
 */
export function parsePositionAnalystPanel(
  body: Record<string, unknown> | null | undefined
): TickerAnalystPanel | null {
  const raw = body?.position_analyst;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const feedState = str(o.feed_state);
  if (!feedState) return null;

  const consensusRaw = o.consensus;
  let consensus: TickerAnalystPanel["consensus"] = null;
  if (consensusRaw && typeof consensusRaw === "object") {
    const c = consensusRaw as Record<string, unknown>;
    consensus = {
      upgrades_30d: num(c.upgrades_30d) ?? 0,
      downgrades_30d: num(c.downgrades_30d) ?? 0,
      momentum: num(c.momentum) ?? 0,
      label: str(c.label) || null,
      unique_firms: c.unique_firms === true
    };
  }

  const ratingsRaw = Array.isArray(o.ratings) ? o.ratings : [];
  const ratings: TickerAnalystRatingRow[] = ratingsRaw
    .map((r): TickerAnalystRatingRow | null => {
      if (!r || typeof r !== "object") return null;
      const row = r as Record<string, unknown>;
      const id = str(row.id);
      const firm = str(row.firm);
      if (!id || !firm) return null;
      return {
        id,
        firm,
        action: str(row.action),
        rating: str(row.rating),
        price_target: num(row.price_target),
        upside_pct: typeof row.upside_pct === "number" && Number.isFinite(row.upside_pct) ? row.upside_pct : null,
        firm_tier: str(row.firm_tier) || "standard",
        published_at: str(row.published_at),
        age_label: str(row.age_label)
      };
    })
    .filter((r): r is TickerAnalystRatingRow => r != null);

  return {
    feed_state: feedState,
    window_days: num(o.window_days) ?? 30,
    consensus,
    ratings,
    total_found: num(o.total_found) ?? ratings.length,
    symbol: str(o.symbol)
  };
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
