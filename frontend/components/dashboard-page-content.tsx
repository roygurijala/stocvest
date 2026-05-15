import { Suspense } from "react";
import { DashboardRedesign } from "@/components/dashboard-redesign";
import { DashboardScannerDeferredFetch } from "@/components/dashboard/dashboard-scanner-deferred-fetch";
import { DashboardScannerSuspenseFallback } from "@/components/dashboard/dashboard-scanner-suspense-fallback";
import { DEFAULT_EARNINGS_SYMBOLS, fetchDashboardFirstSegment } from "@/lib/dashboard/dashboard-page-data";
import { fetchDashboardUserMe, subscriptionPlanFromMe } from "@/lib/dashboard-user-subscription";
import { EMPTY_SCANNER_OVERVIEW } from "@/lib/api/scanner";
import { scannerSetupLoadModeForSubscription, subscriptionAllowsDayTradingSurfaces } from "@/lib/subscription-access";

/**
 * Dashboard loads swing + day scanner payloads when the subscription includes
 * day trading (`swing_day_pro` / `free` / unknown). `swing_pro` loads swing only.
 * Desk visibility matches the same rule on the client (`dayTradingSurfaces`).
 */
export const DASHBOARD_SCANNER_TUNING_BASE = {
  maxUniverseSymbols: 24,
  intradayBarLimit: 60,
  parallelDefaultWatchlist: true,
  swingDailyBarLimit: 220,
  swingSetupsLimit: 4,
  daySetupsLimit: 4
} as const;

/**
 * Server component: Tier 1.C — `user/me` then **dashboard summary** (tape + daily + earnings)
 * when `GET /v1/dashboard/summary` is available; **scanner** streams in nested `Suspense`.
 */
export async function DashboardPageContent() {
  const me = await timeDashboardPhase("user_me", () => fetchDashboardUserMe());
  const plan = subscriptionPlanFromMe(me);
  const dayTradingSurfaces = subscriptionAllowsDayTradingSurfaces(plan, me?.has_full_access === true);
  const scannerSetupLoadMode = scannerSetupLoadModeForSubscription(plan, me?.has_full_access === true);
  const dashboardScannerTuning = {
    ...DASHBOARD_SCANNER_TUNING_BASE,
    scannerSetupLoadMode
  } as const;

  const earningsSymbols = DEFAULT_EARNINGS_SYMBOLS.slice(0, 8);
  const { marketOverview, weeklyIndexRows, sectorRotation, earnings } =
    await fetchDashboardFirstSegment(earningsSymbols);

  return (
    <DashboardRedesign
      marketOverview={marketOverview}
      scannerOverview={EMPTY_SCANNER_OVERVIEW}
      earningsEvents={earnings.upcoming}
      earningsRecent={earnings.recent}
      weeklyIndexRows={weeklyIndexRows}
      sectorRotation={sectorRotation}
      dayTradingSurfaces={dayTradingSurfaces}
      deferredScannerSlot={
        <Suspense fallback={<DashboardScannerSuspenseFallback />}>
          <DashboardScannerDeferredFetch tuning={dashboardScannerTuning} />
        </Suspense>
      }
    />
  );
}
