/**
 * Client-side session-expired event bus.
 *
 * Three contributors mark the session expired:
 *   1. `SessionExpiryWatcher` — proactive timer based on the JWT `exp` claim in the WS-mirror cookie.
 *   2. `browserApiFetch` and other client fetch helpers — reactive, when an API call returns 401/403.
 *   3. Server-rendered redirects to `/login?reason=expired` — the login page calls `clearSessionExpired()`
 *      on render via the `LoginPage` component, so a stale flag can't outlive a fresh visit there.
 *
 * The `SessionExpiredBanner` subscribes and renders the calm sticky bar. The banner controls whether
 * to navigate to login, so users who simply look at cached data are not dumped on the login page.
 *
 * State is mirrored in `sessionStorage` so the banner survives client-side route changes within the
 * same tab. It is intentionally NOT in `localStorage` — a sign-out in another tab should not pollute
 * fresh sessions in others.
 */

const EVENT_NAME = "stocvest:session-expired";
const STORAGE_KEY = "stocvest_session_expired";

export type SessionExpiredReason = "expired" | "auth_error";

export interface SessionExpiredDetail {
  reason: SessionExpiredReason;
  /** Pathname (with search) the user was on when the expiry was noticed; preserved for `?next=`. */
  capturedPath?: string;
}

function safeSessionGet(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeSessionSet(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
}

function safeSessionDelete(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Capture the current path + search so we can resume after login. */
function currentPath(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const path = window.location.pathname || "";
    const search = window.location.search || "";
    return `${path}${search}`;
  } catch {
    return undefined;
  }
}

/**
 * Mark the session as expired. Idempotent — repeated calls (e.g. multiple in-flight 401s) emit
 * only the first event so subscribers don't re-render.
 */
export function markSessionExpired(reason: SessionExpiredReason = "expired"): void {
  if (typeof window === "undefined") return;
  if (safeSessionGet() === "1") return;
  safeSessionSet("1");
  const detail: SessionExpiredDetail = { reason, capturedPath: currentPath() };
  try {
    window.dispatchEvent(new CustomEvent<SessionExpiredDetail>(EVENT_NAME, { detail }));
  } catch {
    /* ignore */
  }
}

export function clearSessionExpired(): void {
  safeSessionDelete();
}

export function isSessionExpiredFlagSet(): boolean {
  return safeSessionGet() === "1";
}

export function subscribeSessionExpired(
  handler: (detail: SessionExpiredDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SessionExpiredDetail>).detail;
    handler(detail ?? { reason: "expired" });
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
