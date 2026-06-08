import { DashboardTradingRoom } from "@/components/dashboard/trading-room/dashboard-trading-room";
import { DashboardScannerClientFetch } from "@/components/dashboard/dashboard-scanner-client-fetch";
import { DASHBOARD_SCANNER_TUNING_BASE } from "@/components/dashboard-page-content";
import { fetchDashboardFirstSegment } from "@/lib/dashboard/dashboard-page-data";
import { DEFAULT_EARNINGS_SYMBOLS, resolveEarningsSymbolList } from "@/lib/api/earnings";
import type { MarketOverview } from "@/lib/api/market";
import { fetchDefaultWatchlistSymbols } from "@/lib/api/watchlists";
import { fetchDashboardUserMe, subscriptionPlanFromMe } from "@/lib/dashboard-user-subscription";
import { EMPTY_SCANNER_OVERVIEW } from "@/lib/api/scanner";
import { isNextRedirect } from "@/lib/next-errors";
import {
  scannerSetupLoadModeForSubscription,
  subscriptionAllowsDayTradingSurfaces
} from "@/lib/subscription-access";

/**
 * Server data load for the Trading Room dashboard (the live `/dashboard`, B63).
 * Mirrors `DashboardPageContent`'s data fetch but renders the redesigned
 * `DashboardTradingRoom`. Also served at `/dashboard/preview`.
 */
const marketOverviewFallback: MarketOverview = {
  snapshots: [],
  news: [],
  error: "Dashboard data is loading client-side."
};

export async function TradingRoomPreviewContent({ userName }: { userName?: string | null }) {
  try {
    const me = await fetchDashboardUserMe();
    const plan = subscriptionPlanFromMe(me);
    const dayTradingSurfaces = subscriptionAllowsDayTradingSurfaces(plan, me?.has_full_access === true);
    const scannerSetupLoadMode = scannerSetupLoadModeForSubscription(plan, me?.has_full_access === true);
    const dashboardScannerTuning = {
      ...DASHBOARD_SCANNER_TUNING_BASE,
      scannerSetupLoadMode
    } as const;

    const watchlist = await fetchDefaultWatchlistSymbols().catch(() => []);
    const earningsSymbols = resolveEarningsSymbolList(DEFAULT_EARNINGS_SYMBOLS, watchlist, { max: 12 });
    const { marketOverview, earnings, deskInitial, sectorRotation } =
      await fetchDashboardFirstSegment(earningsSymbols);

    const profileFirstName = me?.first_name?.trim() || null;

    return (
      <DashboardTradingRoom
        marketOverview={marketOverview}
        scannerOverview={EMPTY_SCANNER_OVERVIEW}
        earningsEvents={earnings.upcoming}
        earningsRecent={earnings.recent}
        dayTradingSurfaces={dayTradingSurfaces}
        deskInitial={deskInitial}
        sectorRotation={sectorRotation}
        userName={profileFirstName ?? userName}
        deferredScannerSlot={<DashboardScannerClientFetch tuning={dashboardScannerTuning} />}
      />
    );
  } catch (err: unknown) {
    if (isNextRedirect(err)) throw err;
    return (
      <DashboardTradingRoom
        marketOverview={marketOverviewFallback}
        scannerOverview={EMPTY_SCANNER_OVERVIEW}
        earningsEvents={[]}
        earningsRecent={[]}
        dayTradingSurfaces={true}
        deskInitial={{ swing: null, day: null }}
        sectorRotation={[]}
        userName={userName ?? null}
        deferredScannerSlot={
          <DashboardScannerClientFetch
            tuning={{ ...DASHBOARD_SCANNER_TUNING_BASE, scannerSetupLoadMode: "both" }}
          />
        }
      />
    );
  }
}
