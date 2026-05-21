import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WatchlistsPageClient } from "@/components/watchlists-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";
import { fetchDashboardUserMe, subscriptionPlanFromMe } from "@/lib/dashboard-user-subscription";
import { watchlistAllowsDualDeskModes, watchlistMaxSymbolsForPlan } from "@/lib/subscription-access";
import type { SubscriptionPlan } from "@/lib/api/contracts";

function watchlistPlanBadgeLabel(plan: SubscriptionPlan | undefined): string {
  if (plan === "swing_day_pro") return "Swing + Day Pro";
  if (plan === "swing_pro") return "Swing Pro";
  return "Free";
}

export default async function DashboardWatchlistsPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const me = await fetchDashboardUserMe();
  const plan = subscriptionPlanFromMe(me);
  const dualDeskMaturation = watchlistAllowsDualDeskModes(plan, me?.has_full_access === true);
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <WatchlistsPageClient
        dualDeskMaturation={dualDeskMaturation}
        planBadgeLabel={watchlistPlanBadgeLabel(plan)}
        maxSymbols={watchlistMaxSymbolsForPlan(plan, me?.has_full_access === true)}
      />
    </AppShell>
  );
}
