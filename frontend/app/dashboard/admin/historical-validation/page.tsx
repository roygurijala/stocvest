import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminHistoricalValidationPageClient } from "@/components/admin-historical-validation-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

/** D2 stratified accuracy — admin / parameter-tuning surface (not end-user signal validation). */
export default async function AdminHistoricalValidationPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <AdminHistoricalValidationPageClient />
    </AppShell>
  );
}
