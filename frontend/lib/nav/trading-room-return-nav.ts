/** Maps `?ref=` on `/dashboard` deep-dive to a labeled return destination. */
export type TradingRoomReturnNav = {
  label: string;
  href: string;
};

/** Resolve contextual back navigation from a Trading Room deep-link `ref`. */
export function resolveTradingRoomReturnNav(refRaw: string | null | undefined): TradingRoomReturnNav | null {
  const r = (refRaw ?? "").trim().toLowerCase();
  if (!r) return null;
  if (r === "invest" || r.startsWith("invest-") || r === "gem-rail") {
    return { label: "Invest", href: "/dashboard/invest" };
  }
  if (r === "portfolio" || r === "my-portfolio" || r === "holdings") {
    return { label: "My Portfolio", href: "/dashboard/my-portfolio" };
  }
  if (r === "scanner") return { label: "Scanner", href: "/dashboard/scanner" };
  if (r === "watchlist") return { label: "Watchlists", href: "/dashboard/watchlists" };
  if (r === "journal") return { label: "Journal", href: "/dashboard/journal" };
  if (r === "trade-plans") return { label: "Trade plans", href: "/dashboard/trade-plans" };
  if (r === "setup-evolution") {
    return { label: "Setup evolution", href: "/dashboard/setup-evolution" };
  }
  return null;
}

/**
 * Prefer browser history when the user arrived from another in-app dashboard route.
 * Falls back to the mapped `href` when history is empty or external.
 */
export function canTradingRoomHistoryBack(): boolean {
  if (typeof window === "undefined") return false;
  if (window.history.length <= 1) return false;
  try {
    const ref = document.referrer;
    if (!ref) return false;
    const prev = new URL(ref);
    if (prev.origin !== window.location.origin) return false;
    if (!prev.pathname.startsWith("/dashboard")) return false;
    return prev.pathname !== "/dashboard";
  } catch {
    return false;
  }
}
