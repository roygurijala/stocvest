import { redirect } from "next/navigation";
import { fetchAllBrokerOverviews } from "@/lib/api/brokers";
import { fetchJournalEntries } from "@/lib/api/journal";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { fetchScannerOverview } from "@/lib/api/scanner";
import { fetchOptionChainOverview } from "@/lib/api/options";
import { fetchIbkrFuturesOverview } from "@/lib/api/futures";
import { fetchCryptoOverview } from "@/lib/api/crypto";
import { fetchPortfolioOverview } from "@/lib/api/portfolio";
import { getServerSession } from "@/lib/auth/session";
import { DashboardShell } from "@/components/dashboard-shell";

export default async function DashboardPage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }
  const [brokerOverviews, marketOverview, journalEntries, pdtStatus] = await Promise.all([
    fetchAllBrokerOverviews(),
    fetchMarketOverview(),
    fetchJournalEntries().catch(() => []),
    fetchPdtStatus().catch(() => null)
  ]);
  const [scannerOverview, optionsOverview, cryptoOverview, futuresOverview] = await Promise.all([
    fetchScannerOverview(pdtStatus),
    fetchOptionChainOverview("AAPL"),
    fetchCryptoOverview("X:BTCUSD"),
    fetchIbkrFuturesOverview()
  ]);
  const portfolioOverview = await fetchPortfolioOverview(brokerOverviews);
  return (
    <DashboardShell
      session={session}
      brokerOverviews={brokerOverviews}
      marketOverview={marketOverview}
      journalEntries={journalEntries}
      pdtStatus={pdtStatus}
      scannerOverview={scannerOverview}
      optionsOverview={optionsOverview}
      futuresOverview={futuresOverview}
      cryptoOverview={cryptoOverview}
      portfolioOverview={portfolioOverview}
    />
  );
}
