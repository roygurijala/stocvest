import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WatchlistsPageClient } from "@/components/watchlists-page-client";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardWatchlistsPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session}>
      <WatchlistsPageClient />
    </AppShell>
  );
}
