import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ScannerPageClient } from "@/components/scanner-page-client";
import { fetchScannerOverview } from "@/lib/api/scanner";
import { fetchEarningsCalendar } from "@/lib/api/earnings";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";
import { fetchDashboardUserMe, subscriptionPlanFromMe } from "@/lib/dashboard-user-subscription";
import { scannerSetupLoadModeForSubscription, subscriptionAllowsDayTradingSurfaces } from "@/lib/subscription-access";

export default async function DashboardScannerPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const me = await fetchDashboardUserMe();
  const plan = subscriptionPlanFromMe(me);
  const dayTradingSurfaces = subscriptionAllowsDayTradingSurfaces(plan, me?.has_full_access === true);
  const scannerSetupLoadMode = scannerSetupLoadModeForSubscription(plan, me?.has_full_access === true);
  const overview = await fetchScannerOverview(null, [], {
    loadTuning: { parallelDefaultWatchlist: true, scannerSetupLoadMode }
  });
  const scannerSymbols = Array.from(
    new Set([...overview.gapIntelligence.map((g) => g.symbol), ...overview.setups.map((s) => s.symbol)])
  );
  const earnings = await fetchEarningsCalendar(scannerSymbols, 2);
  const earningsBySymbol = Object.fromEntries(
    [...earnings.upcoming, ...earnings.recent].map((e) => [e.symbol.toUpperCase(), e])
  );
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <ScannerPageClient
        initialOverview={overview}
        initialTimestampIso={new Date().toISOString()}
        earningsBySymbol={earningsBySymbol}
        dayTradingSurfaces={dayTradingSurfaces}
      />
    </AppShell>
  );
}
