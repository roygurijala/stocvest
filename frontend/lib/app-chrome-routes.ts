import { scannerTerminalEnabled } from "@/lib/nav-features";

/** Routes that render their own session header instead of the legacy TopBar. */
export function usesTradingSessionChrome(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (pathname === "/dashboard" || pathname === "/dashboard/preview") return true;
  if (pathname === "/dashboard/scanner/preview") return true;
  if (pathname === "/dashboard/scanner" && scannerTerminalEnabled()) return true;
  return false;
}
