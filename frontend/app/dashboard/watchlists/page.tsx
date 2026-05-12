import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { WatchlistsPageClient } from "@/components/watchlists-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function DashboardWatchlistsPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <WatchlistsPageClient />
    </AppShell>
  );
}
