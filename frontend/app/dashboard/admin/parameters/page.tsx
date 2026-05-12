import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminParametersPageClient } from "@/components/admin-parameters-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

export default async function AdminParametersPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <AdminParametersPageClient />
    </AppShell>
  );
}
