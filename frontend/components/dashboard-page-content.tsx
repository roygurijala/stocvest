import { DashboardRedesign } from "@/components/dashboard-redesign";
import { fetchDailyBarClosesBySymbol, fetchMarketOverview, fetchSnapshotsForSymbols } from "@/lib/api/market";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner";
import { DEFAULT_EARNINGS_SYMBOLS, fetchEarningsCalendar } from "@/lib/api/earnings";
import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import type { ScannerCoreData } from "@/lib/api/scanner";
import type { EarningsResponse } from "@/lib/api/earnings";
import { isNextRedirect } from "@/lib/next-errors";
import { pctChangeOverDailySessions } from "@/lib/session-return-math";
import { stocvestAuthedFetch } from "@/lib/bff/stocvest-authed";
import type { PortfolioActiveRow, SectorRotationChip } from "@/components/dashboard-redesign";
import type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";

/**
 * Dashboard Top Signals: **swing daily only** (DailyBarScanner). No intraday
 * `POST /v1/signals/day/setups` — avoids session ORB / fast EMA copy on a swing-first home surface.
 * Gap intelligence + market context still load here for Market Pulse / gaps.
 */
export const DASHBOARD_SCANNER_TUNING = {
  maxUniverseSymbols: 24,
  intradayBarLimit: 60,
  parallelDefaultWatchlist: true,
  scannerSetupLoadMode: "swing" as const,
  swingDailyBarLimit: 220,
  swingSetupsLimit: 4
} as const;

/** Allow gap + snapshots + bars + day/setups to finish without forcing empty scanner fallback (Vercel: set maxDuration on dashboard page). */
const DASHBOARD_MARKET_TIMEOUT_MS = 58_000;
const DASHBOARD_SCANNER_TIMEOUT_MS = 58_000;
const DASHBOARD_EARNINGS_TIMEOUT_MS = 5000;
const DASHBOARD_DAILY_BARS_TIMEOUT_MS = 14_000;
const DASHBOARD_PORTFOLIO_TIMEOUT_MS = 10_000;

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

async function fetchDashboardPortfolioRows(): Promise<PortfolioActiveRow[]> {
  try {
    const res = await stocvestAuthedFetch("/v1/portfolio/positions/open", { method: "GET" });
    if (!res.ok) return [];
    const body = (await res.json()) as { positions?: Record<string, unknown>[] };
    const positions = Array.isArray(body.positions) ? body.positions : [];
    const syms = [...new Set(positions.map((p) => String(p.symbol ?? "").trim().toUpperCase()).filter(Boolean))];
    const snaps = syms.length > 0 ? await fetchSnapshotsForSymbols(syms) : [];
    const snapBy = new Map<string, SnapshotPayload>();
    snaps.forEach((s) => {
      if (s?.symbol) snapBy.set(String(s.symbol).trim().toUpperCase(), s);
    });
    return positions.map((p) => {
      const sym = String(p.symbol ?? "").trim().toUpperCase();
      const entryRaw = p.entry_price;
      const entry =
        typeof entryRaw === "number" && Number.isFinite(entryRaw)
          ? entryRaw
          : Number.parseFloat(String(entryRaw ?? "NaN"));
      const sharesRaw = p.shares_equivalent;
      const shares =
        typeof sharesRaw === "number" && Number.isFinite(sharesRaw)
          ? sharesRaw
          : Number.parseFloat(String(sharesRaw ?? "NaN"));
      const snap = snapBy.get(sym);
      const last =
        snap && typeof snap.last_trade_price === "number" && Number.isFinite(snap.last_trade_price)
          ? snap.last_trade_price
          : null;
      const pnlDollars =
        last != null && Number.isFinite(entry) && Number.isFinite(shares) ? (last - entry) * shares : null;
      return { symbol: sym, side: "long", entry, last, pnlDollars };
    });
  } catch {
    return [];
  }
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
    return {
      ...row,
      pct5d: pctChangeOverDailySessions(closes, 5),
      lastPrice
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

  const [marketOverview, scannerCore, earnings, dailyCloses, portfolioActive] = await Promise.all([
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
    timeoutFallback(fetchDailyBarClosesBySymbol(dailyBarSymbols, 8), DASHBOARD_DAILY_BARS_TIMEOUT_MS, {} as Record<string, number[]>),
    timeoutFallback(fetchDashboardPortfolioRows(), DASHBOARD_PORTFOLIO_TIMEOUT_MS, [] as PortfolioActiveRow[])
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
      portfolioActive={portfolioActive}
    />
  );
}
