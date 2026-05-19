export const SCANNER_INSIGHT_SESSION_KEY = "stocvest_scanner_insight_open";

/** Persist Scan insight open/closed for the browser tab session. */
export function readScannerInsightOpen(defaultOpen = false): boolean {
  if (typeof window === "undefined") return defaultOpen;
  try {
    const v = window.sessionStorage.getItem(SCANNER_INSIGHT_SESSION_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* private mode */
  }
  return defaultOpen;
}

export function writeScannerInsightOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SCANNER_INSIGHT_SESSION_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}
