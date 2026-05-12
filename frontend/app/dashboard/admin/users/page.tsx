import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminUsersPageClient } from "@/components/admin-users-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function AdminUsersPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <AdminUsersPageClient />
    </AppShell>
  );
}
