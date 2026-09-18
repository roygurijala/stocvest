/**
 * 11 GICS sector SPDRs — client-safe (no next/headers).
 * Keep in lockstep with `DASHBOARD_SECTOR_ETFS` in dashboard_summary.py.
 */
export const SECTOR_ROTATION_META: readonly { symbol: string; label: string }[] = [
  { symbol: "XLK", label: "Tech" },
  { symbol: "XLC", label: "Comm" },
  { symbol: "XLE", label: "Energy" },
  { symbol: "XLF", label: "Financials" },
  { symbol: "XLY", label: "Cons. disc." },
  { symbol: "XLP", label: "Cons. staples" },
  { symbol: "XLV", label: "Health care" },
  { symbol: "XLI", label: "Industrials" },
  { symbol: "XLB", label: "Materials" },
  { symbol: "XLU", label: "Utilities" },
  { symbol: "XLRE", label: "Real estate" }
];
