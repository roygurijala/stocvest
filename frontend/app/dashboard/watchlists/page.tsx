import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WatchlistsPageClient } from "@/components/watchlists-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";
import { fetchDashboardUserMe, subscriptionPlanFromMe } from "@/lib/dashboard-user-subscription";
import { scannerSetupLoadModeForSubscription } from "@/lib/subscription-access";

export default async function DashboardWatchlistsPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const me = await fetchDashboardUserMe();
  const plan = subscriptionPlanFromMe(me);
  const scannerSetupLoadMode = scannerSetupLoadModeForSubscription(plan, me?.has_full_access === true);
  const maturationSummaryMode: "day" | "swing" = scannerSetupLoadMode === "swing" ? "swing" : "day";
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <WatchlistsPageClient maturationSummaryMode={maturationSummaryMode} />
    </AppShell>
  );
}
