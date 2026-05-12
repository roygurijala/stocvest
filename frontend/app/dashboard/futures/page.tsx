import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FuturesDashboardPanel } from "@/components/futures-dashboard-panel";
import { fetchIbkrFuturesOverview } from "@/lib/api/futures";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function DashboardFuturesPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const overview = await fetchIbkrFuturesOverview();
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <h1 style={{ marginTop: 0 }}>Futures</h1>
      <FuturesDashboardPanel overview={overview} />
    </AppShell>
  );
}
