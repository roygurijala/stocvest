import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContentLoading } from "@/components/content-loading";
import { TradePlansHubClient } from "@/components/trade-plan/trade-plans-hub-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default function TradePlansPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <Suspense fallback={<ContentLoading compact />}>
        <TradePlansHubClient />
      </Suspense>
    </AppShell>
  );
}
