import { AppShell } from "@/components/app-shell";
import { DashboardRedesign, type SectorRotationChip } from "@/components/dashboard-redesign";
import type { MarketOverview } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import type { AuthSession } from "@/lib/auth/types";
import type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";

interface DashboardShellProps {
  session: AuthSession;
  marketOverview: MarketOverview;
  scannerOverview: ScannerOverview;
  earningsEvents: EarningsEvent[];
}

export function DashboardShell({
  session,
  marketOverview,
  scannerOverview,
  earningsEvents
}: DashboardShellProps) {
  const snap = new Map(marketOverview.snapshots.map((s) => [String(s.symbol || "").toUpperCase(), s]));
  const lastOf = (sym: string): number | null => {
    const s = snap.get(sym);
    const v = s?.last_trade_price;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const weeklyIndexRows: WeeklyIndexRow[] = [
    { symbol: "SPY", label: "Large cap", pct5d: null, lastPrice: lastOf("SPY") },
    { symbol: "QQQ", label: "Tech / growth", pct5d: null, lastPrice: lastOf("QQQ") },
    { symbol: "IWM", label: "Small cap", pct5d: null, lastPrice: lastOf("IWM") }
  ];
  const sectorRotation: SectorRotationChip[] = [
    { symbol: "XLK", label: "Tech", pct5d: null },
    { symbol: "XLC", label: "Comm", pct5d: null },
    { symbol: "XLE", label: "Energy", pct5d: null },
    { symbol: "XLF", label: "Financials", pct5d: null },
    { symbol: "XLY", label: "Cons. disc.", pct5d: null }
  ];
  return (
    <AppShell session={session}>
      <DashboardRedesign
        marketOverview={marketOverview}
        scannerOverview={scannerOverview}
        earningsEvents={earningsEvents}
        earningsRecent={[]}
        weeklyIndexRows={weeklyIndexRows}
        sectorRotation={sectorRotation}
      />
    </AppShell>
  );
}
