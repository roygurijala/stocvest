/**
 * Product positioning: swing-first; day trading as an add-on tier.
 * Billing is not wired here — this drives UI copy and future entitlement checks.
 */
export type PlanTierId = "free_swing" | "swing_pro" | "swing_day_pro";

export type PlanTier = {
  id: PlanTierId;
  name: string;
  tagline: string;
  swing: "limited" | "full";
  dayTrading: "preview" | "none" | "full";
  highlights: string[];
};

export const PLAN_TIERS: PlanTier[] = [
  {
    id: "free_swing",
    name: "Swing (Free)",
    tagline: "Swing focus with guardrails",
    swing: "limited",
    dayTrading: "preview",
    highlights: [
      "Default watchlist: up to 5 symbols with scheduled + on-demand maturation.",
      "Peek at day-trading panels: read-only or throttled so you can see how intraday mode looks.",
      "Watchlists and alerts within free-tier caps."
    ]
  },
  {
    id: "swing_pro",
    name: "Swing Pro",
    tagline: "Full swing — no artificial limits",
    swing: "full",
    dayTrading: "none",
    highlights: [
      "Default watchlist: up to 50 symbols; full swing scans, composites, and journal where enabled.",
      "Same six-layer engine; tuned for multi-day holds and daily context.",
      "Optional: hide day-trading chrome entirely if you only swing."
    ]
  },
  {
    id: "swing_day_pro",
    name: "Swing + Day Pro",
    tagline: "Everything in Swing Pro plus full day trading",
    swing: "full",
    dayTrading: "full",
    highlights: [
      "Default watchlist: up to 100 symbols; adds intraday composite, scanner, ORB/VWAP context, and PDT-aware execution paths.",
      "One subscription for traders who run both horizons with consistent scoring.",
      "Same six-layer architecture end-to-end — no separate “lite” math for day mode."
    ]
  }
];

export function planTierById(id: PlanTierId): PlanTier | undefined {
  return PLAN_TIERS.find((p) => p.id === id);
}

/** Placeholder until billing exposes the active tier. */
export const DEFAULT_UI_PLAN: PlanTierId = "swing_pro";
