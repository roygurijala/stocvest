/**
 * Server-only dashboard data fetch helpers (RSC / `dashboard-page-content`).
 * Keeps timeouts + fallbacks in one module for Tier 1.C deferred scanner path.
 */
import {
  fetchDashboardSummary,
  marketOverviewFromDashboardSummary
} from "@/lib/api/dashboard-summary";
import { fetchDailyBarClosesBySymbol, fetchMarketOverview } from "@/lib/api/market";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner";
import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import type { EarningsEvent, EarningsResponse } from "@/lib/api/earnings";
import type { ScannerCoreData, ScannerLoadTuning } from "@/lib/api/scanner";
import { DEFAULT_EARNINGS_SYMBOLS, fetchEarningsCalendar } from "@/lib/api/earnings";
import { pctChangeOverDailySessions } from "@/lib/session-return-math";
import type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";
import { timeoutFallback } from "@/lib/dashboard/dashboard-fetch-resilience";
import { timeDashboardPhase } from "@/lib/dashboard/load-timing";

export type DashboardSectorRotationRow = { symbol: string; label: string; pct5d: number | null };

export const DASHBOARD_MARKET_TIMEOUT_MS = 58_000;
export const DASHBOARD_SCANNER_TIMEOUT_MS = 58_000;
export const DASHBOARD_EARNINGS_TIMEOUT_MS = 5000;
export const DASHBOARD_DAILY_BARS_TIMEOUT_MS = 14_000;

const INDEX_WEEKLY_META: readonly Omit<WeeklyIndexRow, "pct5d" | "lastPrice">[] = [
  { symbol: "SPY", label: "Large cap" },
  { symbol: "QQQ", label: "Tech / growth" },
  { symbol: "IWM", label: "Small cap" }
];

const SECTOR_ROTATION_META: readonly { symbol: string; label: string }[] = [
  { symbol: "XLK", label: "Tech" },
  { symbol: "XLC", label: "Comm" },
  { symbol: "XLE", label: "Energy" },
  { symbol: "XLF", label: "Financials" },
  { symbol: "XLY", label: "Cons. disc." }
];

function buildWeeklyRows(dailyCloses: Record<string, number[]>, snapshots: SnapshotPayload[]): WeeklyIndexRow[] {
  const snapBy = new Map(snapshots.map((s) => [String(s.symbol).trim().toUpperCase(), s] as const));
  return INDEX_WEEKLY_META.map((row) => {
    const closes = dailyCloses[row.symbol] ?? [];
    const snap = snapBy.get(row.symbol);
    const lastPrice =
      snap && typeof snap.last_trade_price === "number" && Number.isFinite(snap.last_trade_price)
        ? snap.last_trade_price
        : null;
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

function buildSectorRows(dailyCloses: Record<string, number[]>): DashboardSectorRotationRow[] {
  return SECTOR_ROTATION_META.map((row) => ({
    ...row,
    pct5d: pctChangeOverDailySessions(dailyCloses[row.symbol] ?? [], 5)
  }));
}

const marketFallback: MarketOverview = { snapshots: [], news: [], error: "Market data timed out." };

const scannerFallback: ScannerCoreData = {
  gapIntelligence: [],
  setups: [],
  spyPct: null,
  qqqPct: null,
  regimeLabel: "Neutral",
  swingUniverseSymbolCount: null,
  gapIntelligenceSnapshotSymbolCount: null,
  watchlistStatus: null,
  error: "Scanner timed out."
};

export type DashboardFirstSegment = {
  marketOverview: MarketOverview;
  weeklyIndexRows: WeeklyIndexRow[];
  sectorRotation: DashboardSectorRotationRow[];
  earnings: { upcoming: EarningsEvent[]; recent: EarningsEvent[] };
};

/**
 * Tier 1.C Phase 2: one API call for tape + daily + earnings; falls back to legacy
 * parallel fetches if the aggregate is unavailable (pre-deploy API or timeout).
 */
export async function fetchDashboardFirstSegment(earningsSymbols: string[]): Promise<DashboardFirstSegment> {
  const summary = await timeDashboardPhase("dashboard_summary", () =>
    timeoutFallback(
      fetchDashboardSummary({
        earningsSymbols,
        earningsDays: 7,
        sparklineLimit: 12,
        dailyLimit: 8
      }),
      DASHBOARD_MARKET_TIMEOUT_MS,
      null
    )
  );

  if (summary) {
    const marketOverview = marketOverviewFromDashboardSummary(summary);
    const weeklyIndexRows = buildWeeklyRows(summary.daily_closes, marketOverview.snapshots);
    const sectorRotation = buildSectorRows(summary.daily_closes);
    return {
      marketOverview,
      weeklyIndexRows,
      sectorRotation,
      earnings: {
        upcoming: summary.earnings.upcoming ?? [],
        recent: summary.earnings.recent ?? []
      }
    };
  }

  const [marketSlice, earningsSlice] = await Promise.all([
    fetchDashboardMarketDailySlice(),
    fetchDashboardEarningsSlice(earningsSymbols)
  ]);
  return {
    marketOverview: marketSlice.marketOverview,
    weeklyIndexRows: marketSlice.weeklyIndexRows,
    sectorRotation: marketSlice.sectorRotation,
    earnings: earningsSlice
  };
}

/** Market tape + index/sector daily closes for weekly context (legacy path / fallback). */
export async function fetchDashboardMarketDailySlice() {
  const dailyBarSymbols = [...INDEX_WEEKLY_META.map((r) => r.symbol), ...SECTOR_ROTATION_META.map((r) => r.symbol)];

  const [marketOverview, dailyCloses] = await Promise.all([
    timeDashboardPhase("market_overview", () =>
      timeoutFallback(
        fetchMarketOverview(["SPY", "QQQ", "IWM", "I:VIX", "^VIX"], { sparklineBarLimit: 12 }),
        DASHBOARD_MARKET_TIMEOUT_MS,
        marketFallback
      )
    ),
    timeDashboardPhase("daily_bar_closes", () =>
      timeoutFallback(fetchDailyBarClosesBySymbol(dailyBarSymbols, 8), DASHBOARD_DAILY_BARS_TIMEOUT_MS, {} as Record<string, number[]>)
    )
  ]);

  const weeklyIndexRows = buildWeeklyRows(dailyCloses, marketOverview.snapshots);
  const sectorRotation = buildSectorRows(dailyCloses);
  return { marketOverview, weeklyIndexRows, sectorRotation };
}

/** Earnings calendar only — streams in nested `Suspense` after market + daily (Tier 1.C). */
export async function fetchDashboardEarningsSlice(
  earningsSymbols: string[]
): Promise<{ upcoming: EarningsEvent[]; recent: EarningsEvent[] }> {
  const earningsFallback: EarningsResponse = {
    symbols: earningsSymbols,
    days: 7,
    upcoming: [],
    recent: [],
    notice: "Earnings feed timed out."
  };
  const earnings = await timeDashboardPhase("earnings_calendar", () =>
    timeoutFallback(fetchEarningsCalendar(earningsSymbols, 7), DASHBOARD_EARNINGS_TIMEOUT_MS, earningsFallback)
  );
  return { upcoming: earnings.upcoming, recent: earnings.recent };
}

export async function fetchDashboardScannerCoreSlice(tuning: ScannerLoadTuning): Promise<ScannerCoreData> {
  return timeDashboardPhase("scanner_core", () =>
    timeoutFallback(
      loadScannerDataWithoutBrief(null, [], tuning, null),
      DASHBOARD_SCANNER_TIMEOUT_MS,
      scannerFallback
    )
  );
}

export { DEFAULT_EARNINGS_SYMBOLS };
