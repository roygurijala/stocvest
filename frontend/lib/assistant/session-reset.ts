/**
 * Storage + reset helpers for the STOCVEST Assistant.
 *
 * The assistant persists a small slice of state ({@link ASSISTANT_STORAGE_KEY}) to
 * `sessionStorage` so a refresh inside the same tab doesn't lose the conversation. The
 * key is intentionally `sessionStorage` (not `localStorage`) so a sign-out in another
 * tab cannot leak the previous session's conversation into a new one.
 *
 * Two callers wipe this state:
 *
 * 1. The assistant itself, when it detects the page identifier has changed or a session
 *    expiry event fires — that keeps cross-page context bleed from happening when the
 *    user navigates between dashboard surfaces.
 * 2. The sign-out buttons (`sidebar.tsx`, `mobile-nav-drawer.tsx`), via an `onClick` that
 *    fires before the server action redirect — guaranteeing the next visitor on the same
 *    tab (likely the same person on the anonymous home page) doesn't see the previous
 *    authenticated conversation.
 *
 * A custom DOM event is dispatched so a mounted `StocvestAssistant` component can also
 * clear its in-memory state without waiting for a remount.
 */

export const ASSISTANT_STORAGE_KEY = "stocvest_assistant_state_v1";
export const ASSISTANT_RESET_EVENT = "stocvest:assistant-reset";

export function clearAssistantSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ASSISTANT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(ASSISTANT_RESET_EVENT));
  } catch {
    /* ignore */
  }
}

export function subscribeAssistantReset(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = () => handler();
  window.addEventListener(ASSISTANT_RESET_EVENT, listener);
  return () => window.removeEventListener(ASSISTANT_RESET_EVENT, listener);
}
