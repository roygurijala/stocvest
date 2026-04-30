import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FuturesDashboardPanel } from "@/components/futures-dashboard-panel";
import { fetchIbkrFuturesOverview } from "@/lib/api/futures";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardFuturesPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const overview = await fetchIbkrFuturesOverview();
  return (
    <AppShell session={session}>
      <h1 style={{ marginTop: 0 }}>Futures</h1>
      <FuturesDashboardPanel overview={overview} />
    </AppShell>
  );
}
