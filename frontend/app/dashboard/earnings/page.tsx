import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { EarningsPageClient } from "@/components/earnings-page-client";
import {
  DEFAULT_EARNINGS_SYMBOLS,
  fetchEarningsCalendar,
  resolveEarningsSymbolList
} from "@/lib/api/earnings";
import { fetchDefaultWatchlistSymbols } from "@/lib/api/watchlists";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function DashboardEarningsPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const watchlist = await fetchDefaultWatchlistSymbols().catch(() => []);
  const symbols = resolveEarningsSymbolList(DEFAULT_EARNINGS_SYMBOLS, watchlist, { max: 30 });
  const earnings = await fetchEarningsCalendar(symbols, 30);
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
