/**
 * Reference-counted scroll lock for modals and drawers.
 * Locks the dashboard ``<main>`` scroll root when present, otherwise ``body``.
 */

export const APP_SCROLL_ROOT_SELECTOR = "[data-app-scroll-root]";

let lockCount = 0;
let savedOverflows: Map<HTMLElement, string> | null = null;

function getLockTargets(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const targets: HTMLElement[] = [];
  const appMain = document.querySelector<HTMLElement>(APP_SCROLL_ROOT_SELECTOR);
  if (appMain) targets.push(appMain);
  targets.push(document.body);
  return targets;
}

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }
  if (lockCount === 0) {
    savedOverflows = new Map();
    for (const el of getLockTargets()) {
      savedOverflows.set(el, el.style.overflow);
      el.style.overflow = "hidden";
    }
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released || typeof document === "undefined") return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0 && savedOverflows) {
      for (const [el, prev] of savedOverflows) {
        el.style.overflow = prev;
      }
      savedOverflows = null;
    }
  };
}

/** Clears any stuck scroll lock (e.g. after client navigation or bfcache restore). */
export function resetBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  lockCount = 0;
  for (const el of getLockTargets()) {
    el.style.overflow = "";
  }
  document.documentElement.style.overflow = "";
  savedOverflows = null;
}
