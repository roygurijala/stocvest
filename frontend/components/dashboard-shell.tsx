import { AppShell } from "@/components/app-shell";
import { DashboardRedesign } from "@/components/dashboard-redesign";
import type { MarketOverview } from "@/lib/api/market";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { AuthSession } from "@/lib/auth/types";

interface DashboardShellProps {
  session: AuthSession;
  marketOverview: MarketOverview;
  pdtStatus: PDTStatusPayload | null;
  scannerOverview: ScannerOverview;
}

export function DashboardShell({ session, marketOverview, pdtStatus, scannerOverview }: DashboardShellProps) {
  return (
    <AppShell session={session}>
      <DashboardRedesign marketOverview={marketOverview} pdtStatus={pdtStatus} scannerOverview={scannerOverview} />
    </AppShell>
  );
}
