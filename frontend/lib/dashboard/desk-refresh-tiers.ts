/**
 * Dashboard refresh tiers — single source of truth for Opportunity Desk cadence.
 *
 * @see docs/OPPORTUNITY_DESK_AND_DASHBOARD_RADAR.md §4
 */

/** Tier A — market pulse / regime (edge cache). */
export const DESK_REFRESH_TIER_A_MS = 60_000;

/** Tier B — movers radar (snapshot math only). */
export const DESK_REFRESH_TIER_B_MS = 15 * 60_000;

/** Manual "Refresh desk" cooldown. */
export const DESK_MANUAL_REFRESH_COOLDOWN_MS = 5 * 60_000;

/** How long a symbol stays on the "Recently hot" rail after leaving top discovery. */
export const DESK_RECENTLY_HOT_TTL_MS = 24 * 60 * 60_000;

export const DESK_DISCOVERY_DISPLAY_LIMIT = 15;
export const DESK_MOVERS_RADAR_LIMIT = 50;
export const DESK_SURVIVOR_LIMIT = 150;

export type DeskRefreshTier = "pulse" | "movers" | "discovery";

export function deskRefreshIntervalMs(tier: DeskRefreshTier): number {
  switch (tier) {
    case "pulse":
      return DESK_REFRESH_TIER_A_MS;
    case "movers":
      return DESK_REFRESH_TIER_B_MS;
    case "discovery":
      return DESK_REFRESH_TIER_B_MS;
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

/** US equity RTH 9:30–16:00 ET, Mon–Fri (best-effort; matches `live-signals.ts`). */
export function isUsEquityRth(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (wd === "Sat" || wd === "Sun") return false;
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutes = h * 60 + m;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/**
 * Whether client polling should run for a tier (pauses Tier B outside RTH;
 * Tier A may still run for edge pulse).
 */
export function shouldPollDeskTier(tier: DeskRefreshTier, now: Date = new Date()): boolean {
  if (tier === "pulse") return true;
  return isUsEquityRth(now);
}
