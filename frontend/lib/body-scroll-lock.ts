/**
 * Reference-counted scroll lock for modals and drawers.
 * Locks both `html` and `body` and compensates for scrollbar width (Windows / macOS).
 */

let lockCount = 0;
let savedBodyOverflow = "";
let savedHtmlOverflow = "";
let savedBodyPaddingRight = "";

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }
  if (lockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    savedBodyPaddingRight = document.body.style.paddingRight;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released || typeof document === "undefined") return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = savedBodyOverflow;
      document.documentElement.style.overflow = savedHtmlOverflow;
      document.body.style.paddingRight = savedBodyPaddingRight;
    }
  };
}

/** Clears any stuck body lock (e.g. after client navigation or bfcache restore). */
export function resetBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  lockCount = 0;
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
  document.documentElement.style.overflow = "";
  savedBodyOverflow = "";
  savedHtmlOverflow = "";
  savedBodyPaddingRight = "";
}

/** @deprecated Main scroll is on ``body``; kept for tests that query the attribute. */
export const APP_SCROLL_ROOT_SELECTOR = "[data-app-scroll-root]";
