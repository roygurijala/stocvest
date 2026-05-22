/**
 * Weekly vs short-horizon timeframe context from composite API.
 */

export type WeeklyTimeframeWire = {
  weekly_bias: string;
  weekly_change_pct: number;
  weekly_rsi: number;
  weekly_note: string;
  bars_used: number;
};

export type TimeframeAlignmentWire = {
  aligned: boolean;
  strength: string;
  composite_score_modifier: number;
  label: string;
  mode?: string;
};

export type TimeframeContext = {
  weekly: WeeklyTimeframeWire;
  alignment: TimeframeAlignmentWire;
  shortHorizonLabel: string;
};

export function parseWeeklyTimeframe(raw: unknown): WeeklyTimeframeWire | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const note = typeof o.weekly_note === "string" ? o.weekly_note.trim() : "";
  if (!note && o.weekly_bias == null) return null;
  return {
    weekly_bias: String(o.weekly_bias ?? "neutral").toLowerCase(),
    weekly_change_pct: Number(o.weekly_change_pct ?? 0),
    weekly_rsi: Number(o.weekly_rsi ?? 50),
    weekly_note: note || "Weekly context unavailable.",
    bars_used: Number(o.bars_used ?? 0)
  };
}

export function parseTimeframeAlignment(raw: unknown): TimeframeAlignmentWire | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (!label) return null;
  return {
    aligned: o.aligned === true,
    strength: String(o.strength ?? "moderate"),
    composite_score_modifier: Number(o.composite_score_modifier ?? 0),
    label,
    mode: typeof o.mode === "string" ? o.mode : undefined
  };
}

export function resolveTimeframeContext(
  body: Record<string, unknown> | null | undefined,
  tradingMode: "swing" | "day"
): TimeframeContext | null {
  if (!body) return null;
  const weekly = parseWeeklyTimeframe(body.weekly_timeframe);
  const alignment = parseTimeframeAlignment(body.timeframe_alignment);
  if (!weekly || !alignment) return null;
  const shortHorizonLabel = tradingMode === "day" ? "Intraday technical" : "Daily structure";
  return { weekly, alignment, shortHorizonLabel };
}

export function isTimeframeCounterTrend(ctx: TimeframeContext | null): boolean {
  return ctx?.alignment.strength === "counter-trend";
}

export function timeframeStrengthTone(strength: string): "aligned" | "caution" | "neutral" {
  if (strength === "strong") return "aligned";
  if (strength === "counter-trend") return "caution";
  return "neutral";
}
