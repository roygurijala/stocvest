import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminAuditPageClient } from "@/components/admin-audit-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function AdminAuditPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <AdminAuditPageClient />
    </AppShell>
  );
}
