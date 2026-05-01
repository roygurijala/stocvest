import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PortfolioPageClient } from "@/components/portfolio-page-client";
import { fetchAllBrokerOverviews } from "@/lib/api/brokers";
import { fetchPortfolioOverview } from "@/lib/api/portfolio";
import { fetchEarningsCalendar } from "@/lib/api/earnings";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardPortfolioPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const brokerOverviews = await fetchAllBrokerOverviews();
  const overview = await fetchPortfolioOverview(brokerOverviews);
  const symbols = Array.from(
    new Set(
      brokerOverviews.flatMap((b) =>
        Object.values(b.positionsByAccount).flatMap((rows) => rows.map((r) => r.symbol))
      )
    )
  );
  const earnings = await fetchEarningsCalendar(symbols, 2);
  const earningsBySymbol = Object.fromEntries([...earnings.upcoming, ...earnings.recent].map((e) => [e.symbol.toUpperCase(), e]));
  return (
    <AppShell session={session}>
      <PortfolioPageClient brokerOverviews={brokerOverviews} overview={overview} earningsBySymbol={earningsBySymbol} />
    </AppShell>
  );
}
