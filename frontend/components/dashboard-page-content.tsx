import { DashboardRedesign } from "@/components/dashboard-redesign";
import { fetchDailyBarClosesBySymbol, fetchMarketOverview } from "@/lib/api/market";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner";
import { DEFAULT_EARNINGS_SYMBOLS, fetchEarningsCalendar } from "@/lib/api/earnings";
import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import type { ScannerCoreData } from "@/lib/api/scanner";
import type { EarningsResponse } from "@/lib/api/earnings";
import { isNextRedirect } from "@/lib/next-errors";
import { pctChangeOverDailySessions } from "@/lib/session-return-math";
import type { SectorRotationChip } from "@/components/dashboard-redesign";
import type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";

/**
 * Dashboard renders TWO independent decision desks (Swing Desk + Day Desk),
 * each with its own posture and "what would re-enable" copy. Both setup
 * sources load on every dashboard mount — `POST /v1/signals/swing/setups`
 * (daily cadence) and `POST /v1/signals/day/setups` (intraday cadence) —
 * so the Day Desk can render real posture instead of a placeholder.
 * The render layer partitions results by `setup.scanner_mode` so the two
 * engines never share a row, a score, or a verdict.
 * Gap intelligence + market context load here for the shared Market Context
 * region above the two desks.
 */
export const DASHBOARD_SCANNER_TUNING = {
  maxUniverseSymbols: 24,
  intradayBarLimit: 60,
  parallelDefaultWatchlist: true,
  scannerSetupLoadMode: "both" as const,
  swingDailyBarLimit: 220,
  swingSetupsLimit: 4,
  daySetupsLimit: 4
} as const;

/** Allow gap + snapshots + bars + day/setups to finish without forcing empty scanner fallback (Vercel: set maxDuration on dashboard page). */
const DASHBOARD_MARKET_TIMEOUT_MS = 58_000;
const DASHBOARD_SCANNER_TIMEOUT_MS = 58_000;
const DASHBOARD_EARNINGS_TIMEOUT_MS = 5000;
const DASHBOARD_DAILY_BARS_TIMEOUT_MS = 14_000;

const INDEX_WEEKLY_META: readonly Omit<WeeklyIndexRow, "pct5d" | "lastPrice">[] = [
  { symbol: "SPY", label: "Large cap" },
  { symbol: "QQQ", label: "Tech / growth" },
  { symbol: "IWM", label: "Small cap" }
];

const SECTOR_ROTATION_META: readonly Omit<SectorRotationChip, "pct5d">[] = [
  { symbol: "XLK", label: "Tech" },
  { symbol: "XLC", label: "Comm" },
  { symbol: "XLE", label: "Energy" },
  { symbol: "XLF", label: "Financials" },
  { symbol: "XLY", label: "Cons. disc." }
];

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

function buildWeeklyRows(
  dailyCloses: Record<string, number[]>,
  snapshots: SnapshotPayload[]
): WeeklyIndexRow[] {
  const snapBy = new Map(snapshots.map((s) => [String(s.symbol).trim().toUpperCase(), s] as const));
  return INDEX_WEEKLY_META.map((row) => {
    const closes = dailyCloses[row.symbol] ?? [];
    const snap = snapBy.get(row.symbol);
    const lastPrice =
      snap && typeof snap.last_trade_price === "number" && Number.isFinite(snap.last_trade_price)
        ? snap.last_trade_price
        : null;
    // Take the last 5 daily closes (newest at the end) for the inline sparkline
    // inside Shared Context · Section A. The Polygon aggregates feed returns
    // bars oldest → newest, so a tail slice preserves order. Defensive: when
    // fewer than 5 closes are available, we still pass what we have through —
    // the sparkline component handles short / empty arrays gracefully.
    const closes5d = closes.length > 0 ? closes.slice(-5) : undefined;
    return {
      ...row,
      pct5d: pctChangeOverDailySessions(closes, 5),
      lastPrice,
      closes5d
    };
  });
}

function buildSectorRows(dailyCloses: Record<string, number[]>): SectorRotationChip[] {
  return SECTOR_ROTATION_META.map((row) => ({
    ...row,
    pct5d: pctChangeOverDailySessions(dailyCloses[row.symbol] ?? [], 5)
  }));
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
    swingUniverseSymbolCount: null,
    error: "Scanner timed out."
  };
  const earningsFallback: EarningsResponse = {
    symbols: earningsSymbols,
    days: 7,
    upcoming: [],
    recent: [],
    notice: "Earnings feed timed out."
  };

  const dailyBarSymbols = [...INDEX_WEEKLY_META.map((r) => r.symbol), ...SECTOR_ROTATION_META.map((r) => r.symbol)];

  const [marketOverview, scannerCore, earnings, dailyCloses] = await Promise.all([
    timeoutFallback(
      fetchMarketOverview(["SPY", "QQQ", "IWM", "I:VIX"], { sparklineBarLimit: 12 }),
      DASHBOARD_MARKET_TIMEOUT_MS,
      marketFallback
    ),
    timeoutFallback(
      loadScannerDataWithoutBrief(null, [], DASHBOARD_SCANNER_TUNING, null),
      DASHBOARD_SCANNER_TIMEOUT_MS,
      scannerFallback
    ),
    timeoutFallback(fetchEarningsCalendar(earningsSymbols, 7), DASHBOARD_EARNINGS_TIMEOUT_MS, earningsFallback),
    timeoutFallback(fetchDailyBarClosesBySymbol(dailyBarSymbols, 8), DASHBOARD_DAILY_BARS_TIMEOUT_MS, {} as Record<string, number[]>)
  ]);

  const weeklyIndexRows = buildWeeklyRows(dailyCloses, marketOverview.snapshots);
  const sectorRotation = buildSectorRows(dailyCloses);

  const scannerOverview = {
    gapIntelligence: scannerCore.gapIntelligence,
    setups: scannerCore.setups,
    morningBrief: undefined,
    error: scannerCore.error,
    spyPct: scannerCore.spyPct,
    qqqPct: scannerCore.qqqPct,
    regimeLabel: scannerCore.regimeLabel,
    swingUniverseSymbolCount: scannerCore.swingUniverseSymbolCount ?? null
  };

  return (
    <DashboardRedesign
      marketOverview={marketOverview}
      scannerOverview={scannerOverview}
      earningsEvents={earnings.upcoming}
      earningsRecent={earnings.recent}
      weeklyIndexRows={weeklyIndexRows}
      sectorRotation={sectorRotation}
    />
  );
}
