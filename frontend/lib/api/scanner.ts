import { apiFetch } from "@/lib/api/client";
import { isNextRedirect } from "@/lib/next-errors";
import type { NewsPayload } from "@/lib/api/market";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import { fetchDefaultWatchlistSymbols } from "@/lib/api/watchlists";

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

export interface GapIntelligenceCatalyst {
  article_id?: string;
  headline: string;
  category: string;
  sentiment: string;
  score: number;
  article_url?: string;
  article_description?: string;
  published_at?: string;
  source?: string;
}

export interface GapIntelligenceItem {
  symbol: string;
  company_name: string;
  gap_pct: number;
  gap_dollars: number;
  prev_close: number;
  current_price: number;
  volume: number;
  volume_vs_avg: number;
  gap_quality_score: number;
  catalyst: GapIntelligenceCatalyst | null;
  has_catalyst: boolean;
  no_catalyst_warning: string | null;
}

export interface ConfluenceSignalChip {
  source?: string;
  label: string;
  detail?: string;
}

/** Headlines forwarded to day/setups for per-symbol geo preview (same window as Market Intelligence). */
export type GeoScanArticleInput = {
  title: string;
  description: string;
  published_utc: string;
};

export function geoScanArticlesFromMarketNews(articles: NewsPayload[] | undefined | null): GeoScanArticleInput[] {
  if (!articles?.length) return [];
  const out: GeoScanArticleInput[] = [];
  for (const a of articles.slice(0, 24)) {
    const title = (a.title ?? "").trim();
    const desc = (a.description ?? "").trim();
    if (!title && !desc) continue;
    out.push({
      title,
      description: desc,
      published_utc: (a.published_utc ?? a.published_at ?? "").trim()
    });
  }
  return out;
}

/**
 * Percent shown on setup rows: **confluence** (0–100) when the API attached it, else intraday **pattern**
 * score from price/volume triggers. Pattern scores often cluster at the scanner gateway (e.g. 0.55 → 55%).
 */
export function topSignalStrengthPercent(setup: IntradaySetupPayload): number {
  if (typeof setup.confluence_score === "number" && Number.isFinite(setup.confluence_score)) {
    return Math.max(0, Math.min(100, Math.round(setup.confluence_score)));
  }
  const raw = typeof setup.score === "number" && Number.isFinite(setup.score) ? setup.score : 0;
  return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

export interface IntradayGeoPreview {
  impact_sector_key: string;
  impact_sector_label: string;
  exposure_band: string;
  weighted_score: number | null;
  summary: string | null;
}

export interface IntradaySetupPayload {
  symbol: string;
  direction: string;
  score: number;
  triggers: string[];
  timestamp_iso: string;
  last_price?: number;
  vwap?: number | null;
  ema9?: number | null;
  disclaimer?: string;
  company_name?: string;
  confluence_score?: number;
  confluence_tier?: string;
  is_confluence_alert?: boolean;
  confirming_signals?: ConfluenceSignalChip[];
  conflicting_signals?: ConfluenceSignalChip[];
  n_confirming?: number;
  n_conflicting?: number;
  historical_note?: string;
  confluence_disclaimer?: string;
  /** Present when day/setups received `geo_scan_articles` (e.g. dashboard Market Intelligence feed). */
  geo_preview?: IntradayGeoPreview | null;
}

export interface MorningBriefPayload {
  generated_at: string;
  conditions: {
    label: string;
    futures_spy_pct: number | null;
    futures_qqq_pct: number | null;
    vix_level: number | null;
    vix_direction: string;
    regime: string;
  };
  economic_events:
    | Array<{ time: string; event_name: string; impact: string }>
    | { message: string };
  earnings_today:
    | Array<{ symbol: string; company: string; time: string; est_eps: number | null }>
    | { message: string };
  top_watch: Record<string, unknown> | null;
  best_setup: { setup_type: string; guidance: string };
  pdt_status: {
    trades_used: number;
    trades_remaining: number;
    status: string;
    message: string;
  };
  disclaimer?: string;
  date_iso?: string;
  title?: string;
}

export interface ScannerOverview {
  gapIntelligence: GapIntelligenceItem[];
  setups: IntradaySetupPayload[];
  morningBrief?: MorningBriefPayload;
  error?: string;
}

/** Snapshot + gap pipeline through intraday setups (no morning briefing). */
export type ScannerCoreData = {
  gapIntelligence: GapIntelligenceItem[];
  setups: IntradaySetupPayload[];
  spyPct: number | null;
  qqqPct: number | null;
  regimeLabel: string;
  error?: string;
};

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

/** Optional caps for scanner load (dashboard vs full scanner page). */
export type ScannerLoadTuning = {
  maxUniverseSymbols?: number;
  intradayBarLimit?: number;
  /** When true, fetches default watchlist in parallel with gap-intelligence (saves one RTT on the critical path). */
  parallelDefaultWatchlist?: boolean;
  /** Max setups returned by `POST /v1/signals/day/setups` (default 10). Lower = less compute and smaller payload. */
  daySetupsLimit?: number;
};

export type DaySetupsRequestExtras = {
  geoScanArticles?: GeoScanArticleInput[];
};

const BARS_BATCH_MAX = 24;
const SNAPSHOTS_BATCH_MAX = 40;

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

async function fetchSnapshotsMatrix(universe: string[]): Promise<(Record<string, unknown> | null)[]> {
  if (universe.length === 0) return [];
  if (universe.length === 1) {
    const row = await apiFetch<Record<string, unknown>>(
      `/v1/market/snapshot?symbol=${encodeURIComponent(universe[0])}`
    );
    return [row && typeof row === "object" ? row : null];
  }
  const bySym = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < universe.length; i += SNAPSHOTS_BATCH_MAX) {
    const slice = universe.slice(i, i + SNAPSHOTS_BATCH_MAX);
    const batch = await apiFetch<{ snapshots?: Record<string, unknown>[] }>(
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
          apiFetch<Record<string, unknown>>(`/v1/market/snapshot?symbol=${encodeURIComponent(symbol)}`)
        )
      );
      slice.forEach((s, j) => {
        const row = rows[j];
        if (row && typeof row === "object") bySym.set(s, row);
      });
    }
  }
  return universe.map((s) => bySym.get(s) ?? null);
}

async function fetchBarsMatrix(
  universe: string[],
  barLimit: number
): Promise<Record<string, Record<string, unknown>[]>> {
  const tf = "1min";
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

  for (let i = 0; i < universe.length; i += BARS_BATCH_MAX) {
    const syms = universe.slice(i, i + BARS_BATCH_MAX);
    const payload = { requests: syms.map((symbol) => ({ symbol, timeframe: tf, limit: barLimit })) };
    const batch = await apiFetch<{ bars_by_symbol?: Record<string, Record<string, unknown>[]> }>(
      "/v1/market/bars-batch",
      { method: "POST", body: JSON.stringify(payload) }
    );
    if (!fillFromBatch(syms, batch)) {
      await Promise.all(
        syms.map(async (symbol) => {
          const bars = await apiFetch<Record<string, unknown>[]>(
            `/v1/market/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}&limit=${barLimit}`
          );
          merge[symbol] = Array.isArray(bars) ? bars : [];
        })
      );
    }
  }
  return merge;
}

export async function loadScannerDataWithoutBrief(
  _pdtStatus: PDTStatusPayload | null,
  watchlistSymbols: string[] = [],
  tuning: ScannerLoadTuning | null = null,
  daySetupsExtras: DaySetupsRequestExtras | null = null
): Promise<ScannerCoreData> {
  try {
    const gapIntelPromise = apiFetch<{ items: GapIntelligenceItem[]; disclaimer?: string }>(
      "/v1/scanner/gap-intelligence",
      {
        method: "POST",
        body: JSON.stringify({
          snapshots: [],
          min_abs_gap_percent: 2.0,
          min_day_volume: 500_000
        })
      }
    );
    const watchlistPromise =
      tuning?.parallelDefaultWatchlist === true
        ? fetchDefaultWatchlistSymbols().catch(() => [] as string[])
        : Promise.resolve(watchlistSymbols);
    const [gapIntelResp, resolvedWatchlist] = await Promise.all([gapIntelPromise, watchlistPromise]);
    if (gapIntelResp == null || !Array.isArray(gapIntelResp.items)) {
      return {
        gapIntelligence: [],
        setups: [],
        spyPct: null,
        qqqPct: null,
        regimeLabel: "Neutral",
        error: "Service temporarily unavailable. Please try again."
      };
    }

    let gapItems = gapIntelResp.items;
    const gapSyms = gapItems.map((g) => g.symbol.trim().toUpperCase()).filter(Boolean);
    const wlSource = tuning?.parallelDefaultWatchlist === true ? resolvedWatchlist : watchlistSymbols;
    const watchUpper = wlSource.map((s) => s.trim().toUpperCase()).filter(Boolean);
    let universe = [...new Set([...gapSyms, ...watchUpper])];
    if (universe.length === 0) {
      universe = [...INTRADAY_FALLBACK_SYMBOLS];
    }
    const barLimit = tuning?.intradayBarLimit ?? 120;
    const maxU = tuning?.maxUniverseSymbols;
    if (typeof maxU === "number" && maxU > 0) {
      universe = capScannerUniverse(universe, maxU);
    }

    const [snapshotRows, barsBySymbol] = await Promise.all([
      fetchSnapshotsMatrix(universe),
      fetchBarsMatrix(universe, barLimit)
    ]);

    gapItems = mergeCompanyNameFromSnapshots(gapItems, universe, snapshotRows);

    const cleanBarsBySymbol = Object.fromEntries(
      Object.entries(barsBySymbol).map(([k, v]) => [k, (v || []) as Record<string, unknown>[]])
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
      const c = snap.change_percent ?? snap.pre_market_change_percent;
      return typeof c === "number" && Number.isFinite(c) ? c : null;
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
    const setups = await apiFetch<IntradaySetupPayload[]>("/v1/signals/day/setups", {
      method: "POST",
      body: JSON.stringify(daySetupsBody)
    });
    if (setups == null) {
      return {
        gapIntelligence: [],
        setups: [],
        spyPct,
        qqqPct,
        regimeLabel,
        error: "Service temporarily unavailable. Please try again."
      };
    }

    return {
      gapIntelligence: gapItems,
      setups,
      spyPct,
      qqqPct,
      regimeLabel
    };
  } catch (error: unknown) {
    if (isNextRedirect(error)) throw error;
    return {
      gapIntelligence: [],
      setups: [],
      spyPct: null,
      qqqPct: null,
      regimeLabel: "Neutral",
      error: error instanceof Error ? error.message : "Unable to connect. Check your connection."
    };
  }
}

export async function fetchMorningBriefPost(
  pdtStatus: PDTStatusPayload | null,
  core: ScannerCoreData
): Promise<MorningBriefPayload | null> {
  if (core.error) {
    return null;
  }
  const pdtAssessment = pdtStatus?.assessment;
  return await apiFetch<MorningBriefPayload>("/v1/signals/day/briefing", {
    method: "POST",
    body: JSON.stringify({
      briefing_date: new Date().toISOString().slice(0, 10),
      pdt_assessment: pdtAssessment
        ? {
            day_trades_in_window: pdtAssessment.day_trades_in_window,
            max_non_exempt: pdtAssessment.max_non_exempt,
            rolling_business_days: pdtAssessment.rolling_business_days,
            warn_near_limit: pdtAssessment.warn_near_limit,
            at_limit: pdtAssessment.at_limit,
            pdt_exempt: pdtAssessment.pdt_exempt,
            allow_next_day_trade: pdtAssessment.allow_next_day_trade
          }
        : undefined,
      morning_brief_context: {
        futures_spy_pct: core.spyPct,
        futures_qqq_pct: core.qqqPct,
        vix_level: null,
        vix_direction: "flat",
        regime: core.regimeLabel,
        economic_events: [],
        earnings_today: [],
        gap_intelligence_items: core.gapIntelligence,
        intraday_setups: core.setups
      }
    })
  });
}

export type FetchScannerOptions = {
  /** When true, blocks on `/v1/signals/day/briefing` (slower). Default false — use Suspense + `fetchMorningBriefPost` on dashboard. */
  includeMorningBrief?: boolean;
  loadTuning?: ScannerLoadTuning | null;
};

export async function fetchScannerOverview(
  pdtStatus: PDTStatusPayload | null,
  watchlistSymbols: string[] = [],
  options: FetchScannerOptions = {}
): Promise<ScannerOverview> {
  const { includeMorningBrief = false, loadTuning = null } = options;
  const core = await loadScannerDataWithoutBrief(pdtStatus, watchlistSymbols, loadTuning);
  if (core.error) {
    return {
      gapIntelligence: [],
      setups: [],
      error: core.error
    };
  }
  let morningBrief: MorningBriefPayload | undefined;
  if (includeMorningBrief) {
    morningBrief = (await fetchMorningBriefPost(pdtStatus, core)) ?? undefined;
  }
  return {
    gapIntelligence: core.gapIntelligence,
    setups: core.setups,
    morningBrief,
    error: undefined
  };
}
