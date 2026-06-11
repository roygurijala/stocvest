import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ScannerPageClient } from "@/components/scanner-page-client";
import { ScannerTerminalPreviewContent } from "@/components/scanner/terminal/scanner-terminal-preview-content";
import type { ScannerOverview } from "@/lib/api/scanner";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";
import { fetchDashboardUserMe, subscriptionPlanFromMe } from "@/lib/dashboard-user-subscription";
import { scannerTerminalEnabled } from "@/lib/nav-features";
import { scannerSetupLoadModeForSubscription, subscriptionAllowsDayTradingSurfaces } from "@/lib/subscription-access";

/** RSC shell only — heavy scanner + earnings load client-side to avoid multi‑MB RSC flights. */
const SCANNER_PAGE_SHELL_OVERVIEW: ScannerOverview = {
  gapIntelligence: [],
  setups: [],
  spyPct: null,
  qqqPct: null,
  regimeLabel: "Neutral",
  swingUniverseSymbolCount: null,
  gapIntelligenceSnapshotSymbolCount: null
};

export default async function DashboardScannerPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const me = await fetchDashboardUserMe();
  const plan = subscriptionPlanFromMe(me);
  const dayTradingSurfaces = subscriptionAllowsDayTradingSurfaces(plan, me?.has_full_access === true);
  const scannerSetupLoadMode = scannerSetupLoadModeForSubscription(plan, me?.has_full_access === true);

  if (scannerTerminalEnabled()) {
    return (
      <AppShell session={session} isAdmin={isAdmin}>
        <ScannerTerminalPreviewContent
          initialScannerSetupLoadMode={scannerSetupLoadMode}
          dayTradingSurfaces={dayTradingSurfaces}
        />
      </AppShell>
    );
  }

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
