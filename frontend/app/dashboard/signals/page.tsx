import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SignalsPageClient } from "@/components/signals-page-client";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { fetchScannerOverview } from "@/lib/api/scanner";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardSignalsPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const pdtStatus = await fetchPdtStatus().catch(() => null);
  const [marketOverview, scannerOverview] = await Promise.all([
    fetchMarketOverview(),
    fetchScannerOverview(pdtStatus)
  ]);

  return (
    <AppShell session={session}>
      <SignalsPageClient marketOverview={marketOverview} scannerOverview={scannerOverview} />
    </AppShell>
  );
}
