import { normalizeAppPathname } from "@/lib/app-pathname";
import { scannerTerminalEnabled } from "@/lib/nav-features";

/** Routes that render their own session header instead of the legacy TopBar. */
export function usesTradingSessionChrome(pathname: string | null | undefined): boolean {
  const path = normalizeAppPathname(pathname);
  if (!path) return false;
  if (path === "/dashboard" || path === "/dashboard/preview") return true;
  if (path === "/dashboard/scanner/preview") return true;
  if (path === "/dashboard/scanner" && scannerTerminalEnabled()) return true;
  return false;
}
