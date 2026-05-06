import { Suspense } from "react";
import { DashboardRedesign } from "@/components/dashboard-redesign";
import { MorningBriefFromCore } from "@/components/morning-brief-from-core";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { geoScanArticlesFromMarketNews, loadScannerDataWithoutBrief } from "@/lib/api/scanner";
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

/** VPC Lambdas + Secrets Manager cold start can exceed a few seconds; keep under typical serverless route budgets. */
const DASHBOARD_MARKET_TIMEOUT_MS = 28_000;
const DASHBOARD_SCANNER_TIMEOUT_MS = 28_000;
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

function MorningBriefSkeleton() {
  return (
    <article
      style={{
        border: "1px solid rgba(148,163,184,0.25)",
        borderRadius: 16,
        padding: 24,
        minHeight: 56,
        maxWidth: 900,
        background: "rgba(148,163,184,0.06)"
      }}
    >
      <style>{`@keyframes stocvest-skeleton { 0% { background-position: 0% 0; } 100% { background-position: 200% 0; } }`}</style>
      <div
        style={{
          height: 14,
          width: "42%",
          borderRadius: 6,
          background: "linear-gradient(90deg, rgba(148,163,184,0.12), rgba(148,163,184,0.22), rgba(148,163,184,0.12))",
          backgroundSize: "200% 100%",
          animation: "stocvest-skeleton 1.2s ease-in-out infinite"
        }}
      />
    </article>
  );
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

  const marketOverview = await timeoutFallback(
    fetchMarketOverview(undefined, { sparklineBarLimit: 12 }),
    DASHBOARD_MARKET_TIMEOUT_MS,
    marketFallback
  );
  const geoScanArticles = geoScanArticlesFromMarketNews(marketOverview.news);

  const [pdtStatus, scannerCore, earnings] = await Promise.all([
    fetchPdtStatus().catch(() => null),
    timeoutFallback(
      loadScannerDataWithoutBrief(null, [], DASHBOARD_SCANNER_TUNING, {
        geoScanArticles: geoScanArticles.length ? geoScanArticles : undefined
      }),
      DASHBOARD_SCANNER_TIMEOUT_MS,
      scannerFallback
    ),
    timeoutFallback(fetchEarningsCalendar(earningsSymbols, 5), DASHBOARD_EARNINGS_TIMEOUT_MS, earningsFallback)
  ]);

  const scannerOverview = {
    gapIntelligence: scannerCore.gapIntelligence,
    setups: scannerCore.setups,
    morningBrief: undefined,
    error: scannerCore.error
  };

  const morningBriefSlot =
    !scannerCore.error ? (
      <Suspense fallback={<MorningBriefSkeleton />}>
        <MorningBriefFromCore core={scannerCore} pdtStatus={pdtStatus} />
      </Suspense>
    ) : null;

  return (
    <DashboardRedesign
      marketOverview={marketOverview}
      pdtStatus={pdtStatus}
      scannerOverview={scannerOverview}
      earningsEvents={earnings.upcoming}
      morningBriefSlot={morningBriefSlot}
    />
  );
}
