import { DashboardRedesign } from "@/components/dashboard-redesign";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner";
import { DEFAULT_EARNINGS_SYMBOLS, fetchEarningsCalendar } from "@/lib/api/earnings";
import type { MarketOverview } from "@/lib/api/market";
import type { ScannerCoreData } from "@/lib/api/scanner";
import type { EarningsResponse } from "@/lib/api/earnings";
import { isNextRedirect } from "@/lib/next-errors";

/** Tighter than the full scanner page; default watchlist loads in parallel with gap-intelligence inside the scanner loader. */
const DASHBOARD_SCANNER_TUNING = {
  maxUniverseSymbols: 24,
  intradayBarLimit: 60,
  parallelDefaultWatchlist: true,
  daySetupsLimit: 6
} as const;

/** Allow gap + snapshots + bars + day/setups to finish without forcing empty scanner fallback (Vercel: set maxDuration on dashboard page). */
const DASHBOARD_MARKET_TIMEOUT_MS = 58_000;
const DASHBOARD_SCANNER_TIMEOUT_MS = 58_000;
const DASHBOARD_EARNINGS_TIMEOUT_MS = 5000;

function timeoutFallback<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        if (isNextRedirect(err)) {
          reject(err);
          return;
        }
        resolve(fallback);
      });
  });
}

/** Server component: all dashboard API work runs here inside Suspense so the shell can paint first. */
export async function DashboardPageContent() {
  const earningsSymbols = DEFAULT_EARNINGS_SYMBOLS.slice(0, 8);
  const marketFallback: MarketOverview = { snapshots: [], news: [], error: "Market data timed out." };
  const scannerFallback: ScannerCoreData = {
    gapIntelligence: [],
    setups: [],
    spyPct: null,
    qqqPct: null,
    regimeLabel: "Neutral",
    error: "Scanner timed out."
  };
  const earningsFallback: EarningsResponse = {
    symbols: earningsSymbols,
    days: 5,
    upcoming: [],
    recent: [],
    notice: "Earnings feed timed out."
  };

  // Market overview does not prefetch `/v1/market/news`; day/setups geo extras are omitted here.
  const [marketOverview, pdtStatus, scannerCore, earnings] = await Promise.all([
    timeoutFallback(
      fetchMarketOverview(["SPY", "QQQ", "IWM", "I:VIX"], { sparklineBarLimit: 12 }),
      DASHBOARD_MARKET_TIMEOUT_MS,
      marketFallback
    ),
    fetchPdtStatus().catch(() => null),
    timeoutFallback(
      loadScannerDataWithoutBrief(null, [], DASHBOARD_SCANNER_TUNING, null),
      DASHBOARD_SCANNER_TIMEOUT_MS,
      scannerFallback
    ),
    timeoutFallback(fetchEarningsCalendar(earningsSymbols, 5), DASHBOARD_EARNINGS_TIMEOUT_MS, earningsFallback)
  ]);

  const scannerOverview = {
    gapIntelligence: scannerCore.gapIntelligence,
    setups: scannerCore.setups,
    morningBrief: undefined,
    error: scannerCore.error,
    spyPct: scannerCore.spyPct,
    qqqPct: scannerCore.qqqPct,
    regimeLabel: scannerCore.regimeLabel
  };

  return (
    <DashboardRedesign
      marketOverview={marketOverview}
      pdtStatus={pdtStatus}
      scannerOverview={scannerOverview}
      earningsEvents={earnings.upcoming}
    />
  );
}
