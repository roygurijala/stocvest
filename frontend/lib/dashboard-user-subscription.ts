import type { SubscriptionPlan, UserMePayload } from "@/lib/api/contracts";

/**
 * Reads `/v1/users/me` on the server (dashboard RSC) so scanner tuning and
 * desk visibility match the billing tier without a client-side flash.
 */
export async function fetchDashboardUserMe(): Promise<UserMePayload | null> {
  try {
    const res = await stocvestAuthedFetch("/v1/users/me", { method: "GET" });
    if (!res.ok) return null;
    const data = (await res.json()) as UserMePayload;
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export function subscriptionPlanFromMe(me: UserMePayload | null): SubscriptionPlan | undefined {
  const p = me?.subscription_plan;
  if (p === "free" || p === "swing_pro" || p === "swing_day_pro") return p;
  return undefined;
}
