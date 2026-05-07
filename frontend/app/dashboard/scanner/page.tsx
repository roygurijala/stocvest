import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ScannerPageClient } from "@/components/scanner-page-client";
import { fetchScannerOverview } from "@/lib/api/scanner";
import { fetchEarningsCalendar } from "@/lib/api/earnings";
import { getServerSession } from "@/lib/auth/session";

export default async function DashboardScannerPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const overview = await fetchScannerOverview(null, [], {
    loadTuning: { parallelDefaultWatchlist: true, scannerSetupLoadMode: "swing" }
  });
  const scannerSymbols = Array.from(
    new Set([...overview.gapIntelligence.map((g) => g.symbol), ...overview.setups.map((s) => s.symbol)])
  );
  const earnings = await fetchEarningsCalendar(scannerSymbols, 2);
  const earningsBySymbol = Object.fromEntries(
    [...earnings.upcoming, ...earnings.recent].map((e) => [e.symbol.toUpperCase(), e])
  );
  return (
    <AppShell session={session}>
      <ScannerPageClient initialOverview={overview} initialTimestampIso={new Date().toISOString()} earningsBySymbol={earningsBySymbol} />
    </AppShell>
  );
}
