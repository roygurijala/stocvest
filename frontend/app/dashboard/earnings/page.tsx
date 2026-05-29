import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { EarningsPageClient } from "@/components/earnings-page-client";
import { fetchMarketEarningsCalendar } from "@/lib/api/earnings";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function DashboardEarningsPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const earnings = await fetchMarketEarningsCalendar(30);
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <EarningsPageClient
        events={[...earnings.upcoming, ...earnings.recent]}
        notice={earnings.notice ?? null}
        source={earnings.source ?? null}
      />
    </AppShell>
  );
}
