"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { UserMePayload } from "@/lib/api/contracts";

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

/** Safe default false until profile is loaded with paid flag. */
export function useHasAIExplanations(): boolean {
  const { profile, loaded } = useContext(UserProfileContext);
  if (!loaded || !profile) return false;
  return profile.has_ai_explanations === true;
}

export function useUserProfileLoaded(): boolean {
  return useContext(UserProfileContext).loaded;
}
