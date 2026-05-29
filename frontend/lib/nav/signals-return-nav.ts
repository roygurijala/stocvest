/** Maps `?ref=` on `/dashboard/signals` to a labeled return destination. */
export type SignalsReturnNav = {
  label: string;
  href: string;
};

/** Resolve contextual back navigation from a Signals deep-link `ref`. */
export function resolveSignalsReturnNav(refRaw: string): SignalsReturnNav | null {
  const r = refRaw.trim().toLowerCase();
  if (!r) return null;
  if (r === "watchlist") return { label: "Watchlists", href: "/dashboard/watchlists" };
  if (r === "scanner") return { label: "Scanner", href: "/dashboard/scanner" };
  if (r === "journal") return { label: "Journal", href: "/dashboard/journal" };
  if (r === "validation") {
    return { label: "Historical validation", href: "/dashboard/admin/historical-validation" };
  }
  if (r === "setup-outcomes") {
    return { label: "Setup outcomes", href: "/dashboard/setup-outcomes" };
  }
  if (r === "setup-evolution") {
    return { label: "Setup evolution", href: "/dashboard/setup-evolution" };
  }
  if (r === "dashboard" || r.startsWith("dashboard-")) {
    return { label: "Dashboard", href: "/dashboard" };
  }
  return null;
}

/**
 * Prefer browser history when the user arrived from another in-app dashboard route.
 * Falls back to the mapped `href` when history is empty or external.
 */
export function canSignalsHistoryBack(): boolean {
  if (typeof window === "undefined") return false;
  if (window.history.length <= 1) return false;
  try {
    const ref = document.referrer;
    if (!ref) return false;
    const prev = new URL(ref);
    if (prev.origin !== window.location.origin) return false;
    return prev.pathname.startsWith("/dashboard") && !prev.pathname.startsWith("/dashboard/signals");
  } catch {
    return false;
  }
}
