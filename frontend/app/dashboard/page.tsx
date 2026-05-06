import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { DashboardPageSkeleton } from "@/components/dashboard-page-skeleton";
import { getServerSession } from "@/lib/auth/session";

/** Dashboard chains market + scanner API work; must exceed client apiFetch and timeoutFallback budgets. */
export const maxDuration = 60;

export default function DashboardPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session}>
      <Suspense fallback={<DashboardPageSkeleton />}>
        <DashboardPageContent />
      </Suspense>
    </AppShell>
  );
}
