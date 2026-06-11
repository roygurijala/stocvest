import { spacing } from "@/lib/design-system";

/** Block height of the fixed app page chrome (`min-h-14` + vertical padding). */
export const APP_CHROME_LAYOUT_HEIGHT = `calc(${spacing[3]} + 3.5rem + ${spacing[3]})`;

/** Fallback when the live chrome bar is not mounted (tests, SSR). Matches layout height at 16px root. */
export const APP_CHROME_LAYOUT_HEIGHT_PX = 80;

const APP_CHROME_SELECTOR = '[data-testid="dashboard-mobile-chrome"]';

/** IntersectionObserver `rootMargin` must use px or % — not `calc()`. */
export function measureAppChromeLayoutHeightPx(): number {
  if (typeof document === "undefined") return APP_CHROME_LAYOUT_HEIGHT_PX;
  const bar = document.querySelector(APP_CHROME_SELECTOR);
  if (bar instanceof HTMLElement) {
    const h = bar.getBoundingClientRect().height;
    if (Number.isFinite(h) && h > 0) return Math.ceil(h);
  }
  return APP_CHROME_LAYOUT_HEIGHT_PX;
}
