/**
 * Maps intraday scanner trigger slugs to swing-oriented copy for dashboard cards.
 * Engine still emits day-structure triggers; labels describe how swing traders should read them.
 */
const TRIGGER_SWING_LABELS: Record<string, string> = {
  orb_breakout_long: "Trend continuation (session ORB)",
  orb_breakout_short: "Trend breakdown (session ORB)",
  orb_retest_long: "ORB retest · dip buy structure",
  orb_retest_short: "ORB retest · rally fade structure",
  ema9_bounce: "Pullback to fast EMA (session)",
  ema9_rejection: "Fast EMA rejection (session)",
  vwap_reclaim: "VWAP reclaim (mean anchor)",
  vwap_rejection: "VWAP rejection (mean anchor)",
  hod_breakout: "Session high expansion",
  lod_breakdown: "Session low breakdown",
  volume_surge: "Volume confirmation",
  gap_hold_long: "Gap hold · upside follow-through",
  gap_fade_short: "Gap fade · downside pressure",
  ema20_cross_above_50: "Daily EMA20 crossed above EMA50",
  ema20_cross_below_50: "Daily EMA20 crossed below EMA50",
  ema50_cross_above_200: "Daily EMA50 crossed above EMA200",
  ema50_cross_below_200: "Daily EMA50 crossed below EMA200",
  ema20_cross_above_200: "Daily EMA20 crossed above EMA200",
  ema20_cross_below_200: "Daily EMA20 crossed below EMA200",
  weekly_rsi_recovery: "Weekly RSI recovery from oversold",
  volume_expansion_breakout: "Volume expansion on 20D range breakout"
};

function labelOne(raw: string): string {
  const k = raw.trim().toLowerCase();
  if (!k) return "";
  return TRIGGER_SWING_LABELS[k] ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Two-part headline for the card (swing framing). */
export function swingStylePatternLine(triggers: string[] | undefined | null): string {
  const parts = (triggers ?? [])
    .map((t) => labelOne(String(t)))
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "Multi-day context · confirm in Evidence";
  if (parts.length === 1) return `${parts[0]} · Daily structure in Evidence`;
  return `${parts[0]} · ${parts[1]}`;
}
