import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { JournalPageClient } from "@/components/journal-page-client";
import { fetchAllBrokerOverviews } from "@/lib/api/brokers";
import { fetchJournalAnalytics, fetchJournalEntries } from "@/lib/api/journal";
import type { JournalAnalyticsPayload } from "@/lib/api/contracts";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

function emptyAnalytics(userId: string): JournalAnalyticsPayload {
  return {
    user_id: userId,
    total_trades: 0,
    open_trades: 0,
    win_rate: 0,
    avg_winner_dollars: 0,
    avg_loser_dollars: 0,
    total_pnl_dollars: 0,
    expectancy: 0,
    current_streak: 0,
    best_setup_type: null,
    worst_setup_type: null,
    best_setup_sample_size: 0,
    worst_setup_sample_size: 0,
    disclaimer: "Signal data for informational purposes only. Not investment advice."
  };
}

export default async function DashboardJournalPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const [entries, analyticsRaw, brokerOverviews] = await Promise.all([
    fetchJournalEntries({ status: "all", limit: 200 }).catch(() => []),
    fetchJournalAnalytics().catch(() => null),
    fetchAllBrokerOverviews().catch(() => [])
  ]);
  const analytics = analyticsRaw ?? emptyAnalytics(session.subject);
  const connectedBroker =
    brokerOverviews.find((b) => b.health?.ok && !b.error)?.broker ??
    (brokerOverviews.length > 0 ? brokerOverviews[0]?.broker : null);

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <JournalPageClient initialEntries={entries} initialAnalytics={analytics} connectedBroker={connectedBroker} />
    </AppShell>
  );
}
