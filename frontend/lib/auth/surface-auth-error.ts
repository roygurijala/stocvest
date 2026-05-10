import { markSessionExpired } from "@/lib/auth/session-expired";

/**
 * If a Response indicates an auth failure, mark the client session expired so the
 * `SessionExpiredBanner` renders. Returns true when it acted, so callers can short-circuit.
 *
 * Only **401** is treated as auth failure — API Gateway's JWT authorizer returns 401 on invalid
 * or expired tokens. 403 is intentionally NOT treated as auth failure here: the STOCVEST API uses
 * 403 for product-rule denials (e.g. PDT lockout, margin requirement) where the user IS
 * authenticated but not allowed to do the action; those should not log them out.
 */
export function surfaceAuthErrorIfAny(response: Response | null | undefined): boolean {
  if (!response) return false;
  if (response.status === 401) {
    markSessionExpired("auth_error");
    return true;
  }
  return false;
}
