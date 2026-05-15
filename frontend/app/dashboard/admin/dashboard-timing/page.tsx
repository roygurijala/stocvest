import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminDashboardTimingPageClient } from "@/components/admin-dashboard-timing-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function AdminDashboardTimingPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <AdminDashboardTimingPageClient />
    </AppShell>
  );
}
