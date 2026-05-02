import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PerformanceTrackingContent } from "@/components/performance-tracking-content";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardPerformancePage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session}>
      <PerformanceTrackingContent />
    </AppShell>
  );
}
