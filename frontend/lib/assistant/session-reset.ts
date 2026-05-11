/**
 * Reset helpers for the STOCVEST Assistant.
 *
 * The assistant is **in-memory only**: a fresh conversation starts on every page load
 * (including hard refresh), every cross-surface navigation, every login/logout, every
 * session-expiry, and every explicit "Sign out" click. Nothing is persisted across page
 * loads because we want zero chance of a stale public-mode conversation surviving into
 * an authenticated context.
 *
 * `ASSISTANT_STORAGE_KEY` is preserved purely so legacy persisted state from earlier
 * builds can be wiped opportunistically on mount; nothing new is ever written to it.
 *
 * Two callers fire the reset event:
 *
 * 1. The assistant itself, when it detects the URL pathname has changed, the auth flag
 *    has flipped, or a session-expiry event fires.
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
  // Defensive cleanup of any legacy persisted state from before the in-memory-only
  // refactor. Today nothing writes to this key — but a tab that still has the old
  // value cached should not show those messages after the user signs out.
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
