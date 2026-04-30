import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PortfolioPageClient } from "@/components/portfolio-page-client";
import { fetchAllBrokerOverviews } from "@/lib/api/brokers";
import { fetchPortfolioOverview } from "@/lib/api/portfolio";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardPortfolioPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const brokerOverviews = await fetchAllBrokerOverviews();
  const overview = await fetchPortfolioOverview(brokerOverviews);
  return (
    <AppShell session={session}>
      <PortfolioPageClient brokerOverviews={brokerOverviews} overview={overview} />
    </AppShell>
  );
}
