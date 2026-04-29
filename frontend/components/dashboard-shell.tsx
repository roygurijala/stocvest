import { logoutAction } from "@/app/login/actions";
import { BrokerConnectivityPanel } from "@/components/broker-connectivity-panel";
import { CryptoPanel } from "@/components/crypto-panel";
import { FuturesDashboardPanel } from "@/components/futures-dashboard-panel";
import { JournalPanel } from "@/components/journal-panel";
import { OptionsChainPanel } from "@/components/options-chain-panel";
import { PDTStatusWidget } from "@/components/pdt-status-widget";
import { PortfolioMultiBrokerPanel } from "@/components/portfolio-multi-broker-panel";
import { OrderEntryForm } from "@/components/order-entry-form";
import { ScannerOverviewPanel } from "@/components/scanner-overview-panel";
import type { BrokerOverview } from "@/lib/api/brokers";
import { MarketOverviewPanel } from "@/components/market-overview-panel";
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
    <main style={{ minHeight: "100vh", padding: "24px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>STOCVEST Dashboard</h1>
          <p style={{ marginTop: 0, opacity: 0.85 }}>
            Signed in as {session.email || session.subject}
          </p>
        </div>
        <form action={logoutAction}>
          <button type="submit">Sign out</button>
        </form>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
          <h3>Signal Dashboard</h3>
          <p>Market status, watchlist snapshots, and headlines are now wired.</p>
        </article>
        <PDTStatusWidget status={pdtStatus} />
      </section>
      <MarketOverviewPanel overview={marketOverview} />
      <ScannerOverviewPanel overview={scannerOverview} />
      <OptionsChainPanel overview={optionsOverview} />
      <CryptoPanel overview={cryptoOverview} />
      <FuturesDashboardPanel overview={futuresOverview} />
      <PortfolioMultiBrokerPanel overview={portfolioOverview} />
      <BrokerConnectivityPanel overviews={brokerOverviews} />
      <OrderEntryForm brokerOverviews={brokerOverviews} />
      <JournalPanel entries={journalEntries} />
    </main>
  );
}
