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
