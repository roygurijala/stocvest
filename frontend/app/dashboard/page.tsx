import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { DashboardPageSkeleton } from "@/components/dashboard-page-skeleton";
import { getServerSession } from "@/lib/auth/session";

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
