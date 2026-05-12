import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OptionsPageClient } from "@/components/options-page-client";
import { fetchOptionChainOverview } from "@/lib/api/options";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function DashboardOptionsPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  const overview = await fetchOptionChainOverview("AAPL");
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <OptionsPageClient overview={overview} />
    </AppShell>
  );
}
