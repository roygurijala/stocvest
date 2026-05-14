import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminErrorLogsPageClient } from "@/components/admin-error-logs-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function AdminErrorLogsPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <AdminErrorLogsPageClient />
    </AppShell>
  );
}
