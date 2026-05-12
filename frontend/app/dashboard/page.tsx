import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ContentLoading } from "@/components/content-loading";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

/** Dashboard chains market + scanner API work; must exceed client apiFetch and timeoutFallback budgets. */
export const maxDuration = 60;

export default function DashboardPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <Suspense fallback={<ContentLoading />}>
        <DashboardPageContent />
      </Suspense>
    </AppShell>
  );
}
