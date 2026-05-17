/**
 * Reference-counted `document.body` scroll lock for modals and drawers.
 */

let lockCount = 0;
let savedBodyOverflow = "";

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }
  if (lockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released || typeof document === "undefined") return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = savedBodyOverflow;
    }
  };
}

/** Clears any stuck body lock (e.g. after client navigation or bfcache restore). */
export function resetBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  lockCount = 0;
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  savedBodyOverflow = "";
}

/** @deprecated Main scroll is on ``body``; kept for tests that query the attribute. */
export const APP_SCROLL_ROOT_SELECTOR = "[data-app-scroll-root]";
