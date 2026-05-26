import type { TrialAccessState, UserMePayload } from "@/lib/api/contracts";

/** Client-side mirror of server flag — UI gating only; API is source of truth. */
export function trialEnforcementUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TRIAL_ENFORCEMENT_ENABLED === "true";
}

export function accessStateFromMe(me: UserMePayload | null | undefined): TrialAccessState {
  if (me?.access_state) return me.access_state;
  if (me?.has_full_access) return "paid";
  return "legacy_free";
}

export function needsPhoneVerification(me: UserMePayload | null | undefined): boolean {
  if (!me?.trial_enforcement_enabled) return false;
  return accessStateFromMe(me) === "phone_required";
}

export function trialExpired(me: UserMePayload | null | undefined): boolean {
  if (!me?.trial_enforcement_enabled) return false;
  return accessStateFromMe(me) === "trial_expired";
}

export function showTrialCountdown(me: UserMePayload | null | undefined): boolean {
  return accessStateFromMe(me) === "trial_active" && typeof me?.trial_days_remaining === "number";
}

export function trialCountdownLabel(me: UserMePayload | null | undefined): string | null {
  if (!showTrialCountdown(me)) return null;
  const days = me?.trial_days_remaining ?? 0;
  if (days <= 0) return "Trial ends today";
  if (days === 1) return "1 day left in trial";
  return `${days} days left in trial`;
}
