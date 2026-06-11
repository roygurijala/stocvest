/**
 * UI-only flags for dashboard nav. Does not gate routes or APIs — users can still
 * open URLs directly. Flip a flag to `true` when the surface ships.
 *
 * Environment override: any flag can be turned on at deploy-time without a code
 * change by setting `NEXT_PUBLIC_STOCVEST_FEATURE_<UPPER_SNAKE>` to `"true"`.
 * The override is read once at module load on the client; the default in this
 * file is the source of truth otherwise.
 *
 * Why a flag for brokers? D10 paused broker integration while we focus on the
 * signal-intelligence surface (scanner, signals, performance, admin hub). The
 * code for broker connections, order entry, and the portfolio surface is still
 * built and tested — it just isn't exposed in the UI. Flip `brokersEnabled`
 * back to `true` (or set `NEXT_PUBLIC_STOCVEST_FEATURE_BROKERS_ENABLED=true`)
 * when the broker re-enable checklist (`docs/BACKLOG.md` B31) is ready.
 */
function envFlag(name: string, fallback: boolean): boolean {
  if (typeof process !== "undefined" && process.env) {
    const raw = process.env[`NEXT_PUBLIC_STOCVEST_FEATURE_${name}`];
    if (typeof raw === "string") {
      const norm = raw.trim().toLowerCase();
      if (norm === "true" || norm === "1") return true;
      if (norm === "false" || norm === "0") return false;
    }
  }
  return fallback;
}

const _brokers = envFlag("BROKERS_ENABLED", false);

export const NAV_FEATURES = {
  options: envFlag("OPTIONS", false),
  crypto: envFlag("CRYPTO", false),
  futures: envFlag("FUTURES", false),
  /**
   * Master switch for every broker-coupled UI surface: trading-mode badge,
   * `/dashboard/portfolio` + Journal nav items, broker connection panel in
   * Settings, "Open order entry" CTAs on Scanner/Signals, onboarding-wizard
   * broker-connect step.
   *
   * Default `false` — D10 paused broker integration. See `docs/BACKLOG.md` B31
   * for the re-enable checklist.
   */
  brokersEnabled: _brokers,
  /**
   * Legacy alias retained so `DASHBOARD_NAV_ITEMS` rows already keyed to
   * `brokerPortfolio` keep filtering correctly. Resolves to `brokersEnabled`
   * — do not set this independently; flip `brokersEnabled` (or the env var).
   */
  brokerPortfolio: _brokers,
  /**
   * Scanner Terminal redesign (funnel sections + detail rail). Default on — `/dashboard/scanner`
   * renders the terminal; legacy UI at `/dashboard/scanner/classic`. Roll back with
   * `NEXT_PUBLIC_STOCVEST_FEATURE_SCANNER_TERMINAL=false`.
   */
  scannerTerminal: envFlag("SCANNER_TERMINAL", true)
} as const;

export type NavFeatureKey = keyof typeof NAV_FEATURES;

export type NavItemWithFeature = {
  href: string;
  label: string;
  feature?: NavFeatureKey;
};

export function isDashboardNavItemEnabled(item: NavItemWithFeature): boolean {
  if (item.feature == null) return true;
  return NAV_FEATURES[item.feature] === true;
}

/**
 * Convenience reader for non-nav components (Settings, Scanner CTAs,
 * Onboarding wizard) that need to gate broker-coupled UI inline.
 *
 * Always prefer this over reading `NAV_FEATURES.brokersEnabled` directly so a
 * future refactor of the flag mechanism only has to update this one helper.
 */
export function brokersEnabled(): boolean {
  return NAV_FEATURES.brokersEnabled === true;
}

export function scannerTerminalEnabled(): boolean {
  return NAV_FEATURES.scannerTerminal === true;
}
