import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AdminDeskBacktestPageClient } from "@/components/admin-desk-backtest-page-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

/** Admin desk backtesting — platform success rate + VIX policy replay. */
export default async function AdminDeskBacktestPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  if (!isAdmin) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <AdminDeskBacktestPageClient />
    </AppShell>
  );
}
