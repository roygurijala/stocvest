import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminHubPageClient } from "@/components/admin-hub-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

/**
 * Admin hub Overview page (`/dashboard/admin`).
 *
 * Entry point for all admin tooling. Same gate as every other admin
 * page: unauthenticated → `/login`, authenticated-but-not-admin →
 * `/dashboard`. The backend gate (`analysis_authorized()`) remains the
 * real perimeter on every admin API call.
 */
export default async function AdminHubPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <AdminHubPageClient />
    </AppShell>
  );
}
