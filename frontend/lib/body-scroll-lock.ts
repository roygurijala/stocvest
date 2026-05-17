/**
 * Reference-counted `document.body` scroll lock for modals and drawers.
 * Prevents a single unmount from leaving `overflow: hidden` stuck on the body.
 */

let lockCount = 0;
let savedBodyOverflow = "";
let savedHtmlOverflow = "";

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }
  if (lockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    savedHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
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
    }
  };
}

/** Clears any stuck body/html lock (e.g. after client navigation or bfcache restore). */
export function resetBodyScrollLock(): void {
  if (typeof document === "undefined") return;
  lockCount = 0;
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
  savedBodyOverflow = "";
  savedHtmlOverflow = "";
}
