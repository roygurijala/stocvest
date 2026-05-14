import { DashboardRedesign } from "@/components/dashboard-redesign";
import { fetchDashboardUserMe, subscriptionPlanFromMe } from "@/lib/dashboard-user-subscription";
import { fetchDailyBarClosesBySymbol, fetchMarketOverview } from "@/lib/api/market";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner";
import { scannerSetupLoadModeForSubscription, subscriptionAllowsDayTradingSurfaces } from "@/lib/subscription-access";
import { DEFAULT_EARNINGS_SYMBOLS, fetchEarningsCalendar } from "@/lib/api/earnings";
import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import type { ScannerCoreData } from "@/lib/api/scanner";
import type { EarningsResponse } from "@/lib/api/earnings";
import { isNextRedirect } from "@/lib/next-errors";
import { pctChangeOverDailySessions } from "@/lib/session-return-math";
import type { SectorRotationChip } from "@/components/dashboard-redesign";
import type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";

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
    // Take the last 6 daily closes (newest at the end) for the inline daily-
    // returns histogram inside Shared Context · Section A. The histogram
    // renders one bar per *daily return* (close-to-close), so N closes
    // produce N − 1 bars — passing 6 yields the 5 per-session bars the tile
    // is designed around. The Polygon aggregates feed returns bars oldest →
    // newest, so a tail slice preserves order. Defensive: when fewer than 6
    // closes are available we still pass what we have through and the
    // histogram component renders whatever bars the data supports.
    //
    // (Field is named `closes5d` because the *window it labels* is the 5-day
    // window — not the array length. The pct5d label and the histogram both
    // live under that umbrella.)
    const closes5d = closes.length > 0 ? closes.slice(-6) : undefined;
    const dh =
      snap && typeof snap.day_high === "number" && Number.isFinite(snap.day_high) ? snap.day_high : null;
    const dl = snap && typeof snap.day_low === "number" && Number.isFinite(snap.day_low) ? snap.day_low : null;
    const dOpen = snap && typeof snap.day_open === "number" && Number.isFinite(snap.day_open) ? snap.day_open : null;
    const pxc =
      snap && typeof snap.prev_close === "number" && Number.isFinite(snap.prev_close) ? snap.prev_close : null;
    const sessionDayRange =
      dh != null && dl != null && dh > dl && lastPrice != null
        ? { low: dl, high: dh, last: lastPrice, open: dOpen, prevClose: pxc }
        : undefined;
    return {
      ...row,
      pct5d: pctChangeOverDailySessions(closes, 5),
      lastPrice,
      closes5d,
      sessionDayRange
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
  const me = await fetchDashboardUserMe();
  const plan = subscriptionPlanFromMe(me);
  const dayTradingSurfaces = subscriptionAllowsDayTradingSurfaces(plan, me?.has_full_access === true);
  const scannerSetupLoadMode = scannerSetupLoadModeForSubscription(plan, me?.has_full_access === true);
  const dashboardScannerTuning = {
    ...DASHBOARD_SCANNER_TUNING_BASE,
    scannerSetupLoadMode
  } as const;

  const earningsSymbols = DEFAULT_EARNINGS_SYMBOLS.slice(0, 8);
  const marketFallback: MarketOverview = { snapshots: [], news: [], error: "Market data timed out." };
  const scannerFallback: ScannerCoreData = {
    gapIntelligence: [],
    setups: [],
    spyPct: null,
    qqqPct: null,
    regimeLabel: "Neutral",
    swingUniverseSymbolCount: null,
    gapIntelligenceSnapshotSymbolCount: null,
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
      loadScannerDataWithoutBrief(null, [], dashboardScannerTuning, null),
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
    swingUniverseSymbolCount: scannerCore.swingUniverseSymbolCount ?? null,
    gapIntelligenceSnapshotSymbolCount: scannerCore.gapIntelligenceSnapshotSymbolCount ?? null
  };

  return (
    <DashboardRedesign
      marketOverview={marketOverview}
      scannerOverview={scannerOverview}
      earningsEvents={earnings.upcoming}
      earningsRecent={earnings.recent}
      weeklyIndexRows={weeklyIndexRows}
      sectorRotation={sectorRotation}
      dayTradingSurfaces={dayTradingSurfaces}
    />
  );
}
