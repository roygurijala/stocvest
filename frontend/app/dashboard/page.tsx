import { redirect } from "next/navigation";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { fetchScannerOverview } from "@/lib/api/scanner";
import { DEFAULT_EARNINGS_SYMBOLS, fetchEarningsCalendar } from "@/lib/api/earnings";
import { getServerSession } from "@/lib/auth/session";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const [marketOverview, pdtStatus] = await Promise.all([
    fetchMarketOverview(),
    fetchPdtStatus().catch(() => null)
  ]);
  const [scannerOverview, earnings] = await Promise.all([
    fetchScannerOverview(pdtStatus),
    fetchEarningsCalendar(DEFAULT_EARNINGS_SYMBOLS, 7)
  ]);
  return (
    <DashboardShell
      session={session}
      marketOverview={marketOverview}
      pdtStatus={pdtStatus}
      scannerOverview={scannerOverview}
      earningsEvents={earnings.upcoming}
    />
  );
}
