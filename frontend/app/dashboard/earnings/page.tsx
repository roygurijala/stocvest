import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { EarningsPageClient } from "@/components/earnings-page-client";
import { DEFAULT_EARNINGS_SYMBOLS, fetchEarningsCalendar } from "@/lib/api/earnings";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function DashboardEarningsPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const earnings = await fetchEarningsCalendar(DEFAULT_EARNINGS_SYMBOLS, 30);
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <EarningsPageClient events={[...earnings.upcoming, ...earnings.recent]} notice={earnings.notice ?? null} />
    </AppShell>
  );
}
