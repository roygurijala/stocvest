import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { OptionsPageClient } from "@/components/options-page-client";
import { fetchOptionChainOverview } from "@/lib/api/options";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardOptionsPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const overview = await fetchOptionChainOverview("AAPL");
  return (
    <AppShell session={session}>
      <OptionsPageClient overview={overview} />
    </AppShell>
  );
}
