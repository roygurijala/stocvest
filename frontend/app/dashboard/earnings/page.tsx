import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { EarningsPageClient } from "@/components/earnings-page-client";
import { fetchMarketEarningsCalendar } from "@/lib/api/earnings";
import { fetchDefaultWatchlistSymbols } from "@/lib/api/watchlists";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";
import { dedupeEarningsEvents } from "@/lib/earnings-filters";

const EARNINGS_CALENDAR_DAYS = 30;

export default async function DashboardEarningsPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const [earnings, watchlistSymbols] = await Promise.all([
    fetchMarketEarningsCalendar(EARNINGS_CALENDAR_DAYS),
    fetchDefaultWatchlistSymbols().catch(() => [] as string[])
  ]);
  const events = dedupeEarningsEvents([...earnings.upcoming, ...earnings.recent]);
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <EarningsPageClient
        events={events}
        notice={earnings.notice ?? null}
        source={earnings.source ?? null}
        watchlistSymbols={watchlistSymbols}
        calendarDays={EARNINGS_CALENDAR_DAYS}
      />
    </AppShell>
  );
}
