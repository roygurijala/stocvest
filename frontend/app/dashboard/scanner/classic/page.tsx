import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ScannerPageClient } from "@/components/scanner-page-client";
import type { ScannerOverview } from "@/lib/api/scanner";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";
import { fetchDashboardUserMe, subscriptionPlanFromMe } from "@/lib/dashboard-user-subscription";
import { scannerSetupLoadModeForSubscription, subscriptionAllowsDayTradingSurfaces } from "@/lib/subscription-access";

/** Legacy scanner UI — always `ScannerPageClient` regardless of terminal flag. */
const SCANNER_PAGE_SHELL_OVERVIEW: ScannerOverview = {
  gapIntelligence: [],
  setups: [],
  spyPct: null,
  qqqPct: null,
  regimeLabel: "Neutral",
  swingUniverseSymbolCount: null,
  gapIntelligenceSnapshotSymbolCount: null
};

export default async function DashboardScannerClassicPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const me = await fetchDashboardUserMe();
  const plan = subscriptionPlanFromMe(me);
  const dayTradingSurfaces = subscriptionAllowsDayTradingSurfaces(plan, me?.has_full_access === true);
  const scannerSetupLoadMode = scannerSetupLoadModeForSubscription(plan, me?.has_full_access === true);

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <ScannerPageClient
        initialOverview={SCANNER_PAGE_SHELL_OVERVIEW}
        initialScannerSetupLoadMode={scannerSetupLoadMode}
        initialTimestampIso={new Date().toISOString()}
        earningsBySymbol={{}}
        dayTradingSurfaces={dayTradingSurfaces}
      />
    </AppShell>
  );
}
