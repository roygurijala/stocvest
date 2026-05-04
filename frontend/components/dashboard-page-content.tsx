import { Suspense } from "react";
import { DashboardRedesign } from "@/components/dashboard-redesign";
import { MorningBriefFromCore } from "@/components/morning-brief-from-core";
import { fetchMarketOverview } from "@/lib/api/market";
import { fetchPdtStatus } from "@/lib/api/pdt";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner";
import { DEFAULT_EARNINGS_SYMBOLS, fetchEarningsCalendar } from "@/lib/api/earnings";
import { fetchDefaultWatchlistSymbols } from "@/lib/api/watchlists";

/** Tighter than the full scanner page: fewer symbols, shorter 1m history, faster day/setups. */
const DASHBOARD_SCANNER_TUNING = { maxUniverseSymbols: 32, intradayBarLimit: 72 } as const;

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
  const [marketOverview, pdtStatus, scannerCore, earnings] = await Promise.all([
    fetchMarketOverview(undefined, { sparklineBarLimit: 12 }),
    fetchPdtStatus().catch(() => null),
    (async () => {
      const wl = await fetchDefaultWatchlistSymbols().catch(() => [] as string[]);
      return loadScannerDataWithoutBrief(null, wl, DASHBOARD_SCANNER_TUNING);
    })(),
    fetchEarningsCalendar(earningsSymbols, 5)
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
