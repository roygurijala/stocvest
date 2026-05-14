"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { UserMePayload } from "@/lib/api/contracts";
import { subscriptionAllowsDayTradingSurfaces } from "@/lib/subscription-access";

export interface UserProfileContextValue {
  profile: UserMePayload | null;
  /** When false and user is logged in, profile fetch may still be in flight. */
  loaded: boolean;
}

export const UserProfileContext = createContext<UserProfileContextValue>({
  profile: null,
  loaded: false
});

export function UserProfileProvider({
  value,
  children
}: {
  value: UserProfileContextValue;
  children: ReactNode;
}) {
  return <UserProfileContext.Provider value={value}>{children}</UserProfileContext.Provider>;
}

/** True once the dashboard profile fetch has settled (success or failure). */
export function useUserProfileLoaded(): boolean {
  const { loaded } = useContext(UserProfileContext);
  return loaded;
}

/** Safe default false until profile is loaded with paid flag. */
export function useHasAIExplanations(): boolean {
  const { profile, loaded } = useContext(UserProfileContext);
  if (!loaded || !profile) return false;
  return profile.has_ai_explanations === true;
}

/** False only for Swing Pro (no day add-on) after profile load; true while loading or on error. */
export function useSubscriptionAllowsDayTrading(): boolean {
  const { profile, loaded } = useContext(UserProfileContext);
  if (!loaded || !profile) return true;
  return subscriptionAllowsDayTradingSurfaces(profile.subscription_plan, profile.has_full_access === true);
}
