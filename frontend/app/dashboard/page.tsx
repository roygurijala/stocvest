import { redirect } from "next/navigation";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { fetchScannerOverview } from "@/lib/api/scanner";
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
  const scannerOverview = await fetchScannerOverview(pdtStatus);
  return (
    <DashboardShell
      session={session}
      marketOverview={marketOverview}
      pdtStatus={pdtStatus}
      scannerOverview={scannerOverview}
    />
  );
}
