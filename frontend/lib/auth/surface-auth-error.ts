import { markSessionExpired } from "@/lib/auth/session-expired";
import { refreshSession } from "@/lib/auth/refresh-session";

/**
 * Auth-failure handler for client fetch helpers that don't go through `browserApiFetch`.
 *
 * On 401, attempt a silent refresh first (`refreshSession()` coalesces parallel callers onto
 * a single in-flight POST). If the refresh succeeds, return `true` without marking the
 * session expired — the caller's *next* interaction will naturally use the freshly-rewritten
 * mirror cookie. We deliberately do NOT retry the original request here: this helper has no
 * access to the original `fetch(...)` call, only the resulting `Response`. Callers that need
 * "refresh-and-retry on the same call" should go through `browserApiFetch` instead.
 *
 * If the refresh itself fails (Cognito refresh expired / revoked / dev-mock with no refresh
 * cookie), mark the session expired so `SessionExpiredBanner` renders.
 *
 * Returns `true` whenever it took some action (refresh or mark-expired) so callers can
 * short-circuit and abandon the now-stale response.
 *
 * Only **401** is treated as auth failure — API Gateway's JWT authorizer returns 401 on
 * invalid or expired tokens. 403 is intentionally NOT treated as auth failure: STOCVEST uses
 * 403 for product-rule denials (PDT lockout, margin, paid-tier gating) where the user IS
 * authenticated.
 */
export async function surfaceAuthErrorIfAny(response: Response | null | undefined): Promise<boolean> {
  if (!response) return false;
  if (response.status !== 401) return false;
  const refreshed = await refreshSession();
  if (!refreshed) {
    markSessionExpired("auth_error");
  }
  return true;
}
