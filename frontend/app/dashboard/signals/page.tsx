import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SignalsPageClient } from "@/components/signals-page-client";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { fetchScannerOverview } from "@/lib/api/scanner";
import { fetchEarningsCalendar } from "@/lib/api/earnings";
import { getServerSession } from "@/lib/auth/session";

const CONTEXTUAL_SIGNALS_REFS = new Set(["scanner", "watchlist", "validation", "journal"]);

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function DashboardSignalsPage({
  searchParams
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const refRaw = (firstParam(searchParams.ref) ?? "").trim().toLowerCase();
  const symRaw = (firstParam(searchParams.symbol) ?? "").trim().toUpperCase();
  const urlSymbol =
    symRaw && CONTEXTUAL_SIGNALS_REFS.has(refRaw) && /^[A-Z]{1,6}$/.test(symRaw) ? symRaw : null;

  const [pdtStatus, marketOverview, scannerOverview] = await Promise.all([
    fetchPdtStatus().catch(() => null),
    fetchMarketOverview(undefined, { sparklineBarLimit: 12 }),
    fetchScannerOverview(null, [], { loadTuning: { parallelDefaultWatchlist: true } })
  ]);
  const symbols = Array.from(new Set(scannerOverview.setups.map((s) => s.symbol)));
  const earnings = await fetchEarningsCalendar(symbols, 3);
  const earningsBySymbol = Object.fromEntries([...earnings.upcoming, ...earnings.recent].map((e) => [e.symbol.toUpperCase(), e]));

  return (
    <AppShell session={session}>
      <SignalsPageClient
        marketOverview={marketOverview}
        scannerOverview={scannerOverview}
        earningsBySymbol={earningsBySymbol}
        signalsPrefill={{ urlSymbol }}
      />
    </AppShell>
  );
}
