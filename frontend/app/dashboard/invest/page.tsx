import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { InvestPageClient } from "@/components/invest/invest-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

/** ADR-004 POS-D13 — Investment home (`/dashboard/invest`). Journey A gem discovery
 *  + Journey B symbol lookup. Ranked candidates load client-side from the scan API. */
export default async function DashboardInvestPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <InvestPageClient />
    </AppShell>
  );
}
