import { isNextRedirect } from "@/lib/next-errors";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type {
  DaySetupsRequestExtras,
  GapIntelligenceItem,
  IntradaySetupPayload,
  ScannerCoreData,
  ScannerLoadTuning,
  ScannerSetupLoadMode,
  WatchlistDashboardStatus
} from "@/lib/api/scanner";
import type { DefaultWatchlistSnapshot } from "@/lib/api/watchlists";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import {
  presentationMaturationState,
  type SymbolTrackingMap
} from "@/lib/watchlist-tracking-presentation";

export type DefaultWatchlistFetch = () => Promise<DefaultWatchlistSnapshot>;

/** Always load tape anchors so Market Pulse (spy/qqq %) and regime are populated even when gaps omit indices. */
const MARKET_PULSE_ANCHORS = ["SPY", "QQQ"] as const;

/** When the scanner has no gap symbols and no user watchlist, intraday bars use this liquid floor. */
const INTRADAY_FALLBACK_SYMBOLS = [
  "SPY",
  "QQQ",
  "AAPL",
  "NVDA",
  "TSLA",
  "MSFT",
  "AMZN",
  "META",
  "AMD",
  "GOOGL"
] as const;

const BARS_BATCH_MAX = 24;
const SNAPSHOTS_BATCH_MAX = 40;

export type ScannerJsonFetch = <T>(path: string, init?: RequestInit) => Promise<T | null>;

function companyNameFromSnapshot(snap: Record<string, unknown> | null | undefined): string {
  if (!snap || typeof snap !== "object") return "";
  const a = snap.company_name;
  const b = (snap as { companyName?: unknown }).companyName;
  for (const v of [a, b]) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function mergeCompanyNameFromSnapshots(
  gapItems: GapIntelligenceItem[],
  universe: string[],
  snapshotRows: (Record<string, unknown> | null)[]
): GapIntelligenceItem[] {
  return gapItems.map((g) => {
    const sym = g.symbol.trim().toUpperCase();
    const idx = universe.indexOf(sym);
    const snap = idx >= 0 ? snapshotRows[idx] : null;
    const fromApi = (typeof g.company_name === "string" && g.company_name.trim()) || "";
    const camel = (g as { companyName?: string }).companyName;
    const fromCamel = typeof camel === "string" ? camel.trim() : "";
    const fromSnap = companyNameFromSnapshot(snap as Record<string, unknown> | null);
    return { ...g, company_name: fromApi || fromCamel || fromSnap };
  });
}

function resolveScannerSetupLoadMode(tuning: ScannerLoadTuning | null): ScannerSetupLoadMode {
  const m = tuning?.scannerSetupLoadMode;
  if (m === "day" || m === "swing" || m === "both") {
    return m;
  }
  if (tuning?.includeSwingDailySetups === true) {
    return "both";
  }
  return "day";
}

function mergeSwingAndDaySetups(swing: IntradaySetupPayload[], day: IntradaySetupPayload[]): IntradaySetupPayload[] {
  const seen = new Set(swing.map((s) => s.symbol.trim().toUpperCase()));
  const rest = day.filter((d) => !seen.has(d.symbol.trim().toUpperCase()));
  const merged = [...swing, ...rest];
  merged.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  return merged;
}

/** Dashboard strip only — omit when the user has no default watchlist symbols this load. */
export function buildWatchlistDashboardStatus(
  watchUpper: string[],
  universe: string[],
  setups: IntradaySetupPayload[],
  maturationBySymbol?: Record<string, string> | null
): WatchlistDashboardStatus | null {
  const w = [...new Set(watchUpper.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (w.length === 0) return null;
  const u = new Set(universe.map((s) => s.trim().toUpperCase()));
  const setupSyms = new Set(setups.map((s) => s.symbol.trim().toUpperCase()).filter(Boolean));
  const mat = maturationBySymbol ?? null;
  let actionable = 0;
  let developing = 0;
  let inactive = 0;
  for (const sym of w) {
    const m = mat?.[sym];
    if (setupSyms.has(sym)) {
      actionable += 1;
    } else if (m === "actionable") {
      actionable += 1;
    } else if (
      m === "developing" ||
      m === "re_evaluating" ||
      m === "not_aligned" ||
      m === "invalidated"
    ) {
      developing += 1;
    } else if (u.has(sym)) {
      developing += 1;
    } else {
      inactive += 1;
    }
  }
  return { monitored: w.length, actionable, developing, inactive };
}

function parseMaturationSummaryRows(
  payload: { by_symbol?: Record<string, { state?: string }> } | null | undefined
): Record<string, WatchlistMaturationRow> {
  const raw = payload?.by_symbol;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, WatchlistMaturationRow> = {};
  for (const [k, v] of Object.entries(raw)) {
    const sym = k.trim().toUpperCase();
    if (!sym || !v || typeof v !== "object") continue;
    const st =
      typeof (v as { state?: unknown }).state === "string"
        ? (v as { state: string }).state.trim().toLowerCase()
        : "";
    if (st) out[sym] = { state: st };
  }
  return out;
}

/** Presentation lens: best state among user-tracked desks (engine still evaluates all). */
async function loadPresentationMaturationBySymbol(
  jsonFetch: ScannerJsonFetch,
  watchUpper: string[],
  trackingMap: SymbolTrackingMap
): Promise<Record<string, string> | null> {
  if (watchUpper.length === 0) return null;
  try {
    const [swingPayload, dayPayload] = await Promise.all([
      jsonFetch<{ by_symbol?: Record<string, { state?: string }> }>(
        "/v1/watchlists/maturation-summary?mode=swing"
      ),
      jsonFetch<{ by_symbol?: Record<string, { state?: string }> }>(
        "/v1/watchlists/maturation-summary?mode=day"
      ).catch(() => null)
    ]);
    const swing = parseMaturationSummaryRows(swingPayload);
    const day = parseMaturationSummaryRows(dayPayload ?? undefined);
    const dualDesk =
      Object.keys(day).length > 0 || Object.values(trackingMap).some((t) => t.day);
    const out: Record<string, string> = {};
    for (const sym of watchUpper) {
      const st = presentationMaturationState(sym, trackingMap, swing[sym], day[sym], dualDesk);
      if (st) out[sym] = st;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function capScannerUniverse(universe: string[], max: number): string[] {
  if (universe.length <= max) return universe;
  const priority = ["SPY", "QQQ"];
  const out: string[] = [];
  for (const p of priority) {
    if (universe.includes(p) && !out.includes(p)) out.push(p);
  }
  for (const s of universe) {
    if (out.length >= max) break;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

async function fetchSnapshotsMatrix(
  jsonFetch: ScannerJsonFetch,
  universe: string[]
): Promise<(Record<string, unknown> | null)[]> {
  if (universe.length === 0) return [];
  if (universe.length === 1) {
    const row = await jsonFetch<Record<string, unknown>>(
      `/v1/market/snapshot?symbol=${encodeURIComponent(universe[0])}`
    );
    return [row && typeof row === "object" ? row : null];
  }
  const bySym = new Map<string, Record<string, unknown>>();
  const snapshotSlices: string[][] = [];
  for (let i = 0; i < universe.length; i += SNAPSHOTS_BATCH_MAX) {
    snapshotSlices.push(universe.slice(i, i + SNAPSHOTS_BATCH_MAX));
  }
  await Promise.all(
    snapshotSlices.map(async (slice) => {
      const batch = await jsonFetch<{ snapshots?: Record<string, unknown>[] }>(
        `/v1/market/snapshots?symbols=${encodeURIComponent(slice.join(","))}`
      );
      if (batch?.snapshots && Array.isArray(batch.snapshots)) {
        for (const row of batch.snapshots) {
          if (!row || typeof row !== "object") continue;
          const sym = String((row as { symbol?: string }).symbol || "")
            .trim()
            .toUpperCase();
          if (sym) bySym.set(sym, row as Record<string, unknown>);
        }
      } else {
        const rows = await Promise.all(
          slice.map((symbol) =>
            jsonFetch<Record<string, unknown>>(`/v1/market/snapshot?symbol=${encodeURIComponent(symbol)}`)
          )
        );
        slice.forEach((s, j) => {
          const row = rows[j];
          if (row && typeof row === "object") bySym.set(s, row);
        });
      }
    })
  );
  return universe.map((s) => bySym.get(s) ?? null);
}

async function fetchBarsMatrix(
  jsonFetch: ScannerJsonFetch,
  universe: string[],
  barLimit: number,
  timeframe: string = "1min"
): Promise<Record<string, Record<string, unknown>[]>> {
  const tf = timeframe;
  const merge: Record<string, Record<string, unknown>[]> = {};
  if (universe.length === 0) return merge;

  const fillFromBatch = (
    syms: string[],
    batch: { bars_by_symbol?: Record<string, Record<string, unknown>[]> } | null
  ): boolean => {
    const raw = batch?.bars_by_symbol;
    if (!raw || typeof raw !== "object") return false;
    for (const sym of syms) {
      const row = raw[sym] ?? raw[sym.toUpperCase()];
      merge[sym] = Array.isArray(row) ? row : [];
    }
    return true;
  };

  const barSlices: string[][] = [];
  for (let i = 0; i < universe.length; i += BARS_BATCH_MAX) {
    barSlices.push(universe.slice(i, i + BARS_BATCH_MAX));
  }
  await Promise.all(
    barSlices.map(async (syms) => {
      const payload = { requests: syms.map((symbol) => ({ symbol, timeframe: tf, limit: barLimit })) };
      const batch = await jsonFetch<{ bars_by_symbol?: Record<string, Record<string, unknown>[]> }>(
        "/v1/market/bars-batch",
        { method: "POST", body: JSON.stringify(payload) }
      );
      if (!fillFromBatch(syms, batch)) {
        await Promise.all(
          syms.map(async (symbol) => {
            const bars = await jsonFetch<Record<string, unknown>[]>(
              `/v1/market/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}&limit=${barLimit}`
            );
            merge[symbol] = Array.isArray(bars) ? bars : [];
          })
        );
      }
    })
  );
  return merge;
}

export async function runScannerLoadWithoutBrief(
  jsonFetch: ScannerJsonFetch,
  fetchDefaultWatchlistFn: DefaultWatchlistFetch,
  _pdtStatus: PDTStatusPayload | null,
  watchlistSymbols: string[] = [],
  tuning: ScannerLoadTuning | null = null,
  daySetupsExtras: DaySetupsRequestExtras | null = null
): Promise<ScannerCoreData> {
  try {
    const gapIntelPromise = jsonFetch<{
      items: GapIntelligenceItem[];
      disclaimer?: string;
      /** Symbols that passed gap-intel liquidity/price/gap gates (before top-N), not raw Polygon row count. */
      snapshot_symbol_count?: number;
    }>("/v1/scanner/gap-intelligence", {
      method: "POST",
      body: JSON.stringify({
        snapshots: [],
        min_abs_gap_percent: 2.0,
        min_day_volume: 500_000
      })
    });
    const watchlistPromise: Promise<DefaultWatchlistSnapshot> =
      tuning?.parallelDefaultWatchlist === true
        ? fetchDefaultWatchlistFn().catch(() => ({ symbols: [], symbol_tracking: {} }))
        : Promise.resolve({
            symbols: watchlistSymbols,
            symbol_tracking: {} as SymbolTrackingMap
          });
    const [gapIntelResp, wlSnap] = await Promise.all([gapIntelPromise, watchlistPromise]);
    /**
     * Gap-intelligence is best-effort for the dashboard/scanner shell: Polygon full-feed +
     * news can 5xx or time out. When the response is missing or malformed, continue with an
     * empty gap list and the liquid fallback universe so tape + setups still load.
     */
    const rawItems =
      gapIntelResp != null && typeof gapIntelResp === "object"
        ? (gapIntelResp as { items?: unknown }).items
        : undefined;
    const gapItemsOk = Array.isArray(rawItems);
    let gapItems: GapIntelligenceItem[] = gapItemsOk ? (rawItems as GapIntelligenceItem[]) : [];
    if (!gapItemsOk && gapIntelResp != null) {
      console.warn("scanner-load: gap-intelligence response missing items[]; using empty gaps + fallback universe");
    } else if (gapIntelResp == null) {
      console.warn("scanner-load: gap-intelligence request failed; using empty gaps + fallback universe");
    }

    const gapIntelSnapshotCount =
      gapIntelResp != null &&
      typeof gapIntelResp === "object" &&
      typeof (gapIntelResp as { snapshot_symbol_count?: unknown }).snapshot_symbol_count === "number" &&
      Number.isFinite((gapIntelResp as { snapshot_symbol_count: number }).snapshot_symbol_count) &&
      (gapIntelResp as { snapshot_symbol_count: number }).snapshot_symbol_count > 0
        ? Math.floor((gapIntelResp as { snapshot_symbol_count: number }).snapshot_symbol_count)
        : null;
    const gapSyms = gapItems.map((g) => g.symbol.trim().toUpperCase()).filter(Boolean);
    const wlSource = tuning?.parallelDefaultWatchlist === true ? wlSnap.symbols : watchlistSymbols;
    const watchUpper = wlSource.map((s) => s.trim().toUpperCase()).filter(Boolean);
    const trackingMap: SymbolTrackingMap = tuning?.parallelDefaultWatchlist === true ? wlSnap.symbol_tracking : {};
    let universe = [...new Set([...MARKET_PULSE_ANCHORS, ...gapSyms, ...watchUpper])];
    if (universe.length === 0) {
      universe = [...INTRADAY_FALLBACK_SYMBOLS];
    }
    const barLimit = tuning?.intradayBarLimit ?? 120;
    const maxU = tuning?.maxUniverseSymbols;
    if (typeof maxU === "number" && maxU > 0) {
      universe = capScannerUniverse(universe, maxU);
    }

    const setupLoadMode = resolveScannerSetupLoadMode(tuning);
    const fetchDailyBars = setupLoadMode === "swing" || setupLoadMode === "both";
    const loadDaySetups = setupLoadMode === "day" || setupLoadMode === "both";
    const loadSwingSetups = setupLoadMode === "swing" || setupLoadMode === "both";
    const maturationSummaryPromise = loadPresentationMaturationBySymbol(jsonFetch, watchUpper, trackingMap);
    /** Intraday bars only feed `POST /v1/signals/day/setups`; swing-only loads skip them (large critical-path savings). */
    const needIntradayBars = loadDaySetups;
    const swingDailyBarLimit = tuning?.swingDailyBarLimit ?? 220;
    const [snapshotRows, barsBySymbol, dailyBarsBySymbol] = await Promise.all([
      fetchSnapshotsMatrix(jsonFetch, universe),
      needIntradayBars ? fetchBarsMatrix(jsonFetch, universe, barLimit, "1min") : Promise.resolve({}),
      fetchDailyBars ? fetchBarsMatrix(jsonFetch, universe, swingDailyBarLimit, "1day") : Promise.resolve({})
    ]);

    gapItems = mergeCompanyNameFromSnapshots(gapItems, universe, snapshotRows);

    const cleanBarsBySymbol = Object.fromEntries(
      Object.entries(barsBySymbol).map(([k, v]) => [k, (v || []) as Record<string, unknown>[]])
    );
    const cleanDailyBarsBySymbol = Object.fromEntries(
      Object.entries(dailyBarsBySymbol).map(([k, v]) => [k, (v || []) as Record<string, unknown>[]])
    );

    const liquidity_by_symbol: Record<
      string,
      { avg_daily_volume: number | null; last_price: number | null; company_name?: string }
    > = {};
    universe.forEach((sym, i) => {
      const snap = snapshotRows[i];
      if (!snap || typeof snap !== "object") return;
      const prevVol = snap.prev_day_volume;
      const adv = typeof prevVol === "number" && Number.isFinite(prevVol) ? prevVol : null;
      const lastRaw = snap.last_trade_price ?? snap.day_open;
      const last = typeof lastRaw === "number" && Number.isFinite(lastRaw) ? lastRaw : null;
      const name = companyNameFromSnapshot(snap as Record<string, unknown>);
      liquidity_by_symbol[sym] = {
        avg_daily_volume: adv,
        last_price: last,
        ...(name ? { company_name: name } : {})
      };
    });

    const snapPct = (snap: Record<string, unknown> | null | undefined): number | null => {
      if (!snap || typeof snap !== "object") return null;
      const pick = (v: unknown): number | null => {
        if (typeof v !== "number" || !Number.isFinite(v)) return null;
        // Guard against broken feed values (seen as -100 when close/baseline is missing).
        if (v <= -99.5) return null;
        return v;
      };
      const direct = pick(snap.change_percent);
      if (direct != null) return direct;
      const pre = pick(snap.pre_market_change_percent);
      if (pre != null) return pre;
      const ah = pick(snap.after_hours_change_percent);
      if (ah != null) return ah;
      const last = snap.last_trade_price;
      const prev = snap.prev_close;
      if (
        typeof last === "number" &&
        typeof prev === "number" &&
        Number.isFinite(last) &&
        Number.isFinite(prev) &&
        prev > 0
      ) {
        const derived = ((last - prev) / prev) * 100;
        return pick(derived);
      }
      return null;
    };
    const spyIdx = universe.indexOf("SPY");
    const qqqIdx = universe.indexOf("QQQ");
    const spySnap = spyIdx >= 0 ? snapshotRows[spyIdx] : null;
    const qqqSnap = qqqIdx >= 0 ? snapshotRows[qqqIdx] : null;
    const spyPct = snapPct(spySnap as Record<string, unknown> | null);
    const qqqPct = snapPct(qqqSnap as Record<string, unknown> | null);
    let regimeLabel = "Neutral";
    if (spyPct != null && qqqPct != null) {
      if (spyPct > 0.2 && qqqPct > 0.15) regimeLabel = "Bullish";
      else if (spyPct < -0.2 || qqqPct < -0.25) regimeLabel = "Bearish";
    }
    const regimeForSetups = regimeLabel.toLowerCase();

    const snapshots_by_symbol: Record<string, Record<string, unknown>> = {};
    universe.forEach((sym, i) => {
      const s = snapshotRows[i];
      if (s && typeof s === "object") snapshots_by_symbol[sym] = s as Record<string, unknown>;
    });

    const setupsLimit = tuning?.daySetupsLimit ?? 10;
    const daySetupsBody: Record<string, unknown> = {
      bars_by_symbol: cleanBarsBySymbol,
      limit: setupsLimit,
      min_score: 0.55,
      liquidity_by_symbol: liquidity_by_symbol,
      snapshots_by_symbol,
      regime: regimeForSetups
    };
    if (daySetupsExtras?.geoScanArticles?.length) {
      daySetupsBody.geo_scan_articles = daySetupsExtras.geoScanArticles;
    }

    const swingSetupsLimit = tuning?.swingSetupsLimit ?? 4;
    const swingReady = loadSwingSetups && Object.keys(cleanDailyBarsBySymbol).length > 0;
    const swingBody: Record<string, unknown> = {
      bars_by_symbol: cleanDailyBarsBySymbol,
      limit: swingSetupsLimit,
      min_score: 0.48,
      liquidity_by_symbol: liquidity_by_symbol,
      snapshots_by_symbol,
      regime: regimeForSetups
    };
    if (daySetupsExtras?.geoScanArticles?.length) {
      swingBody.geo_scan_articles = daySetupsExtras.geoScanArticles;
    }

    let setups: IntradaySetupPayload[] = [];

    if (loadDaySetups && swingReady) {
      const [dayRows, swingSetups] = await Promise.all([
        jsonFetch<IntradaySetupPayload[]>("/v1/signals/day/setups", {
          method: "POST",
          body: JSON.stringify(daySetupsBody)
        }),
        jsonFetch<IntradaySetupPayload[]>("/v1/signals/swing/setups", {
          method: "POST",
          body: JSON.stringify(swingBody)
        }).catch(() => null as IntradaySetupPayload[] | null)
      ]);
      if (dayRows == null) {
        return {
          gapIntelligence: [],
          setups: [],
          spyPct,
          qqqPct,
          regimeLabel,
          swingUniverseSymbolCount: universe.length,
          gapIntelligenceSnapshotSymbolCount: gapIntelSnapshotCount,
          watchlistStatus: buildWatchlistDashboardStatus(watchUpper, universe, []),
          error: "Service temporarily unavailable. Please try again."
        };
      }
      setups = dayRows;
      if (Array.isArray(swingSetups) && swingSetups.length > 0) {
        setups = mergeSwingAndDaySetups(swingSetups, setups);
      }
    } else if (loadDaySetups) {
      const dayRows = await jsonFetch<IntradaySetupPayload[]>("/v1/signals/day/setups", {
        method: "POST",
        body: JSON.stringify(daySetupsBody)
      });
      if (dayRows == null) {
        return {
          gapIntelligence: [],
          setups: [],
          spyPct,
          qqqPct,
          regimeLabel,
          swingUniverseSymbolCount: universe.length,
          gapIntelligenceSnapshotSymbolCount: gapIntelSnapshotCount,
          watchlistStatus: buildWatchlistDashboardStatus(watchUpper, universe, []),
          error: "Service temporarily unavailable. Please try again."
        };
      }
      setups = dayRows;
    } else if (swingReady) {
      try {
        const swingSetups = await jsonFetch<IntradaySetupPayload[]>("/v1/signals/swing/setups", {
          method: "POST",
          body: JSON.stringify(swingBody)
        });
        if (Array.isArray(swingSetups)) {
          setups = swingSetups;
        }
      } catch {
        /* swing-only path: leave setups empty if request fails */
      }
    }

    const maturationBySymbol = await maturationSummaryPromise;

    return {
      gapIntelligence: gapItems,
      setups,
      spyPct,
      qqqPct,
      regimeLabel,
      swingUniverseSymbolCount: universe.length,
      gapIntelligenceSnapshotSymbolCount: gapIntelSnapshotCount,
      watchlistStatus: buildWatchlistDashboardStatus(watchUpper, universe, setups, maturationBySymbol)
    };
  } catch (error: unknown) {
    if (isNextRedirect(error)) throw error;
    return {
      gapIntelligence: [],
      setups: [],
      spyPct: null,
      qqqPct: null,
      regimeLabel: "Neutral",
      swingUniverseSymbolCount: null,
      gapIntelligenceSnapshotSymbolCount: null,
      watchlistStatus: null,
      error: error instanceof Error ? error.message : "Unable to connect. Check your connection."
    };
  }
}
