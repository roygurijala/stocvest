import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PerformanceTrackingContent } from "@/components/performance-tracking-content";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function DashboardPerformancePage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <PerformanceTrackingContent />
    </AppShell>
  );
}
