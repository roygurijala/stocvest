/**
 * Scanner trigger slug → display labels. Day vs swing scopes are separate:
 * session / VWAP / ORB slugs must never label a swing card.
 */

/** Session-scoped triggers — only `getTriggerLabel(..., "day")`. */
export const DAY_TRIGGER_LABELS: Record<string, string> = {
  orb_breakout_long: "ORB Long ↑",
  orb_breakout_short: "ORB Short ↓",
  orb_retest_long: "ORB retest · dip buy",
  orb_retest_short: "ORB retest · rally fade",
  vwap_reclaim: "VWAP Reclaim",
  vwap_rejection: "VWAP Rejection",
  ema9_bounce: "EMA9 Bounce",
  hod_breakout: "Session high expansion",
  lod_breakdown: "Session low breakdown",
  volume_surge: "Volume confirmation",
  gap_hold_long: "Gap hold · upside follow-through",
  gap_fade_short: "Gap fade · downside pressure"
};

/** Daily / weekly structure — safe for swing dashboard copy. */
export const SWING_TRIGGER_LABELS: Record<string, string> = {
  ema9_bounce: "EMA9 Bounce (Daily)",
  ema9_rejection: "EMA9 Rejection (Daily)",
  ema_crossover_daily: "Daily EMA Crossover",
  ema20_cross_above_50: "Daily EMA20 crossed above EMA50",
  ema20_cross_below_50: "Daily EMA20 crossed below EMA50",
  ema50_cross_above_200: "Daily EMA50 crossed above EMA200",
  ema50_cross_below_200: "Daily EMA50 crossed below EMA200",
  ema20_cross_above_200: "Daily EMA20 crossed above EMA200",
  ema20_cross_below_200: "Daily EMA20 crossed below EMA200",
  weekly_rsi_recovery: "Weekly RSI Recovery",
  volume_expansion_breakout: "Volume Expansion (Daily)",
  volume_expansion: "Volume Expansion (Daily)",
  base_breakout: "Base Breakout (Daily)",
  above_sma50: "Above 50-Day MA",
  above_sma200: "Above 200-Day MA",
  hh_hl_pattern: "Higher Highs / Higher Lows",
  pattern_maturity: "Pattern maturity"
};

/** Slugs that are intraday/session-only — never shown on swing copy. */
const INTRADAY_ONLY_SLUGS = new Set([
  "orb_breakout_long",
  "orb_breakout_short",
  "orb_retest_long",
  "orb_retest_short",
  "vwap_reclaim",
  "vwap_rejection",
  "hod_breakout",
  "lod_breakdown",
  "volume_surge",
  "gap_hold_long",
  "gap_fade_short"
]);

function fallbackLabel(slug: string): string {
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Resolve a human label for a trigger slug; scope enforces intraday vs swing language. */
export function getTriggerLabel(slug: string, mode: "day" | "swing"): string {
  const k = slug.trim().toLowerCase();
  if (!k) return "";
  if (mode === "day") {
    if (k in DAY_TRIGGER_LABELS) return DAY_TRIGGER_LABELS[k];
    if (k in SWING_TRIGGER_LABELS) return SWING_TRIGGER_LABELS[k];
    return fallbackLabel(k);
  }
  if (INTRADAY_ONLY_SLUGS.has(k)) return "";
  if (k in SWING_TRIGGER_LABELS) return SWING_TRIGGER_LABELS[k];
  return fallbackLabel(k);
}

function labelForSwingLine(raw: string): string {
  return getTriggerLabel(String(raw), "swing");
}

/** Two-part headline for dashboard swing cards (daily-structure wording only). */
export function swingStylePatternLine(triggers: string[] | undefined | null): string {
  const parts = (triggers ?? []).map((t) => labelForSwingLine(t)).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "Multi-day context · confirm in Evidence";
  if (parts.length === 1) return `${parts[0]} · Daily structure in Evidence`;
  return `${parts[0]} · ${parts[1]}`;
}
