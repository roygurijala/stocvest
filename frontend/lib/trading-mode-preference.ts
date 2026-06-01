/** Shared swing/day preference across Dashboard, Signals, and edge sync. */
export const TRADING_MODE_STORAGE_KEY = "stocvest_trading_mode";

export type TradingModePreference = "swing" | "day";

export function readTradingModePreference(
  fallback: TradingModePreference = "swing"
): TradingModePreference {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(TRADING_MODE_STORAGE_KEY);
    return raw === "day" ? "day" : raw === "swing" ? "swing" : fallback;
  } catch {
    return fallback;
  }
}

export function writeTradingModePreference(mode: TradingModePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TRADING_MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Resolve stored mode for surfaces that may hide the day desk. */
export function resolveTradingModeForSurfaces(
  dayTradingSurfaces: boolean,
  fallback?: TradingModePreference
): TradingModePreference {
  const resolvedFallback: TradingModePreference =
    fallback ?? (dayTradingSurfaces ? "day" : "swing");
  const stored = readTradingModePreference(resolvedFallback);
  if (stored === "day" && dayTradingSurfaces) return "day";
  return "swing";
}
