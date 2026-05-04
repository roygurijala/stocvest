import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SignalsPageClient } from "@/components/signals-page-client";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { fetchScannerOverview } from "@/lib/api/scanner";
import { fetchEarningsCalendar } from "@/lib/api/earnings";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardSignalsPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const pdtStatus = await fetchPdtStatus().catch(() => null);
  const [marketOverview, scannerOverview] = await Promise.all([
    fetchMarketOverview(undefined, { sparklineBarLimit: 12 }),
    fetchScannerOverview(pdtStatus)
  ]);
  const symbols = Array.from(new Set(scannerOverview.setups.map((s) => s.symbol)));
  const earnings = await fetchEarningsCalendar(symbols, 3);
  const earningsBySymbol = Object.fromEntries([...earnings.upcoming, ...earnings.recent].map((e) => [e.symbol.toUpperCase(), e]));

  return (
    <AppShell session={session}>
      <SignalsPageClient marketOverview={marketOverview} scannerOverview={scannerOverview} earningsBySymbol={earningsBySymbol} />
    </AppShell>
  );
}
