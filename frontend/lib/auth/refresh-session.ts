/**
 * Client-side bridge to `POST /api/auth/refresh`.
 *
 * Why this module exists:
 *   Two independent callers race to refresh the session:
 *     1. `SessionExpiryWatcher` — proactive, fires ~2 minutes before the JWT `exp`.
 *     2. `browserApiFetch` (and `surface-auth-error`) — reactive, fires on a 401 from any
 *        in-flight API call.
 *   Without coordination, a busy dashboard with five parallel fetches all returning 401 at the
 *   60-minute mark would kick off five refresh requests, the first of which would rotate
 *   cookies and invalidate the in-flight refresh tokens the others were holding. We use a
 *   module-level single-flight promise so every caller awaits the same refresh, then proceeds
 *   with the new token.
 *
 *   We also keep a short "do not retry" window after a refresh failure so a hard-expired
 *   refresh token doesn't trigger a refresh storm — the `SessionExpiredBanner` is the right
 *   UX surface for that state, not 10 round-trips in a row.
 */

let inFlight: Promise<boolean> | null = null;

/**
 * Earliest UTC ms timestamp at which we are willing to attempt another refresh after a
 * previous failure. Within this window, `refreshSession()` short-circuits to `false` without
 * hitting the BFF — the calm banner is already the right answer.
 */
let cooldownUntil = 0;
const FAILURE_COOLDOWN_MS = 5_000;

/**
 * Refresh the session, coalescing parallel callers onto a single in-flight POST.
 *
 * Returns `true` on success (`/api/auth/refresh` returned 200 and the browser now has fresh
 * cookies), `false` on failure (caller should mark the session expired). Never throws.
 */
export async function refreshSession(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (Date.now() < cooldownUntil) return false;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
        cache: "no-store"
      });
      if (!res.ok) {
        cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
        return false;
      }
      return true;
    } catch {
      cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS;
      return false;
    } finally {
      // Clear the in-flight slot on next tick so any caller that resolved against this
      // promise can still observe the result before a new refresh can start.
      setTimeout(() => {
        inFlight = null;
      }, 0);
    }
  })();

  return inFlight;
}

/**
 * Test hook — reset the module's in-flight + cooldown state between tests so each case starts
 * from a clean slate. Not exposed for production callers.
 */
export function __resetRefreshSessionForTests(): void {
  inFlight = null;
  cooldownUntil = 0;
}
