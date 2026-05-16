import type { SubscriptionPlan } from "@/lib/api/contracts";
import type { ScannerSetupLoadMode } from "@/lib/api/scanner";

/**
 * Swing Pro is swing-only; Swing + Day Pro unlocks intraday surfaces.
 * `free` and unknown plans keep legacy "both desks" behavior until billing tightens.
 * `hasFullAccess` / beta-style overrides unlock everything when true.
 */
export function subscriptionAllowsDayTradingSurfaces(
  plan: SubscriptionPlan | undefined,
  hasFullAccess: boolean | undefined
): boolean {
  if (hasFullAccess === true) return true;
  return plan !== "swing_pro";
}

/** Scanner payload mode for dashboard server fetch — avoids day setup API work for Swing Pro. */
export function scannerSetupLoadModeForSubscription(
  plan: SubscriptionPlan | undefined,
  hasFullAccess: boolean | undefined
): ScannerSetupLoadMode {
  return subscriptionAllowsDayTradingSurfaces(plan, hasFullAccess) ? "both" : "swing";
}

/**
 * Watchlist maturation UI: Swing / Day / "Both" toggles and dual-column rows are
 * **Swing + Day Pro** (and full-access overrides) only. Free and Swing Pro use
 * swing-only maturation on this page (scanner/signals may still show day for free).
 */
export function watchlistAllowsDualDeskModes(
  plan: SubscriptionPlan | undefined,
  hasFullAccess: boolean | undefined
): boolean {
  if (hasFullAccess === true) return true;
  return plan === "swing_day_pro";
}
