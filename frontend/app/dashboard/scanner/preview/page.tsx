import { AppShell } from "@/components/app-shell";
import { ScannerTerminalPreviewContent } from "@/components/scanner/terminal/scanner-terminal-preview-content";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";
import { fetchDashboardUserMe, subscriptionPlanFromMe } from "@/lib/dashboard-user-subscription";
import { scannerSetupLoadModeForSubscription, subscriptionAllowsDayTradingSurfaces } from "@/lib/subscription-access";
import { redirect } from "next/navigation";

/** Scanner terminal preview — same client load path as live `/dashboard/scanner`. */
export const maxDuration = 60;

export default async function ScannerTerminalPreviewPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const me = await fetchDashboardUserMe();
  const plan = subscriptionPlanFromMe(me);
  const dayTradingSurfaces = subscriptionAllowsDayTradingSurfaces(plan, me?.has_full_access === true);
  const scannerSetupLoadMode = scannerSetupLoadModeForSubscription(plan, me?.has_full_access === true);

  return (
    <AppShell session={session} isAdmin={isAdmin} hideTopBar>
      <ScannerTerminalPreviewContent
        initialScannerSetupLoadMode={scannerSetupLoadMode}
        dayTradingSurfaces={dayTradingSurfaces}
        showPreviewBadge
      />
    </AppShell>
  );
}
