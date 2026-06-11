import { normalizeAppPathname } from "@/lib/app-pathname";

export const APP_PAGE_TITLE_BY_PATH: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/scanner": "Scanner",
  "/dashboard/scanner/classic": "Scanner",
  "/dashboard/earnings": "Earnings",
  "/dashboard/signals": "Signals",
  "/dashboard/watchlists": "Watchlist",
  "/dashboard/setup-evolution": "Setup evolution",
  "/dashboard/setup-outcomes": "Setup outcomes",
  "/dashboard/portfolio": "Portfolio",
  "/dashboard/options": "Options",
  "/dashboard/crypto": "Crypto",
  "/dashboard/futures": "Futures",
  "/dashboard/journal": "Journal",
  "/dashboard/settings": "Settings",
  "/dashboard/admin": "Admin",
  "/dashboard/admin/historical-validation": "Historical validation (admin)"
};

export function resolveAppPageTitle(pathname: string | null | undefined): string {
  const normalized = normalizeAppPathname(pathname);
  return APP_PAGE_TITLE_BY_PATH[normalized] ?? "STOCVEST";
}
