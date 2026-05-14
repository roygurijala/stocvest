/**
 * User profile helpers (subscription / feature gates).
 * Context lives in `user-profile-context.tsx` to avoid circular imports with dashboard shell.
 */

export {
  useHasAIExplanations,
  useSubscriptionAllowsDayTrading,
  useUserProfileLoaded,
  UserProfileProvider,
  UserProfileContext
} from "@/lib/user-profile-context";
export type { UserProfileContextValue } from "@/lib/user-profile-context";
