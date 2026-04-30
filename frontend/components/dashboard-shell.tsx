import { AppShell } from "@/components/app-shell";
import { BrokerConnectivityPanel } from "@/components/broker-connectivity-panel";
import { CryptoPanel } from "@/components/crypto-panel";
import { DashboardRedesign } from "@/components/dashboard-redesign";
import { FuturesDashboardPanel } from "@/components/futures-dashboard-panel";
import { JournalPanel } from "@/components/journal-panel";
import { OptionsChainPanel } from "@/components/options-chain-panel";
import { PortfolioMultiBrokerPanel } from "@/components/portfolio-multi-broker-panel";
import { OrderEntryForm } from "@/components/order-entry-form";
import { DashboardRealtime } from "@/components/dashboard-realtime";
import type { BrokerOverview } from "@/lib/api/brokers";
import type { MarketOverview } from "@/lib/api/market";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { OptionChainOverview } from "@/lib/api/options";
import type { FuturesDashboardOverview } from "@/lib/api/futures";
import type { CryptoOverview } from "@/lib/api/crypto";
import type { PortfolioMultiBrokerOverview } from "@/lib/api/portfolio";
import type { JournalEntryPayload } from "@/lib/api/contracts";
import type { AuthSession } from "@/lib/auth/types";

interface DashboardShellProps {
  session: AuthSession;
  brokerOverviews: BrokerOverview[];
  marketOverview: MarketOverview;
  journalEntries: JournalEntryPayload[];
  pdtStatus: PDTStatusPayload | null;
  scannerOverview: ScannerOverview;
  optionsOverview: OptionChainOverview;
  futuresOverview: FuturesDashboardOverview;
  cryptoOverview: CryptoOverview;
  portfolioOverview: PortfolioMultiBrokerOverview;
}

export function DashboardShell({
  session,
  brokerOverviews,
  marketOverview,
  journalEntries,
  pdtStatus,
  scannerOverview,
  optionsOverview,
  futuresOverview,
  cryptoOverview,
  portfolioOverview
}: DashboardShellProps) {
  return (
    <AppShell session={session}>
      <DashboardRedesign marketOverview={marketOverview} pdtStatus={pdtStatus} scannerOverview={scannerOverview} />
      <DashboardRealtime />
      <OptionsChainPanel overview={optionsOverview} />
      <CryptoPanel overview={cryptoOverview} />
      <FuturesDashboardPanel overview={futuresOverview} />
      <PortfolioMultiBrokerPanel overview={portfolioOverview} />
      <BrokerConnectivityPanel overviews={brokerOverviews} />
      <OrderEntryForm brokerOverviews={brokerOverviews} />
      <JournalPanel entries={journalEntries} />
    </AppShell>
  );
}
