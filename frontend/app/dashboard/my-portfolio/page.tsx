import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MyPortfolioClient } from "@/components/portfolio/my-portfolio-client";
import { getDashboardAuthContext } from "@/lib/auth/dashboard-session";

/**
 * Manual portfolio ("STOCVEST manages my portfolio") — user-entered holdings with
 * per-lot cost basis, live market value + unrealized P/L, and portfolio settings
 * (cash + target sizing + benchmark). Advisory-only; distinct from the paused
 * broker portfolio surface at `/dashboard/portfolio`.
 */
export default async function DashboardMyPortfolioPage() {
  const { session, isAdmin } = getDashboardAuthContext();
  if (!session) {
    redirect("/login");
  }
  return (
    <AppShell session={session} isAdmin={isAdmin}>
      <MyPortfolioClient />
    </AppShell>
  );
}
