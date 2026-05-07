import { apiFetch } from "@/lib/api/client";
import type { NewsPayload } from "@/lib/api/market";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import { fetchDefaultWatchlistSymbols } from "@/lib/api/watchlists";
import { runScannerLoadWithoutBrief } from "@/lib/api/scanner-load";
import { topSignalStrengthPercent } from "@/lib/top-signal-strength";

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

export { topSignalStrengthPercent };

export interface IntradayGeoPreview {
  impact_sector_key: string;
  impact_sector_label: string;
  exposure_band: string;
  weighted_score: number | null;
  summary: string | null;
  /** Short labels from headline themes or sector baseline chips. */
  theme_tags?: string[];
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
  /** Set by `POST /v1/signals/swing/setups` (daily-bar swing scanner). */
  scanner_mode?: "swing_daily";
  ema_daily_crossovers?: string[];
  weekly_rsi_recovery?: boolean;
  weekly_rsi?: number | null;
  volume_expansion_ratio?: number | null;
  pattern_maturity_days?: number;
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
  /** From scanner core / day-setups pipeline (no extra API). */
  spyPct?: number | null;
  qqqPct?: number | null;
  regimeLabel?: string;
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

/** Which setup endpoints power the scanner core (dashboard defaults to both via `includeSwingDailySetups`). */
export type ScannerSetupLoadMode = "day" | "swing" | "both";

/** Optional caps for scanner load (dashboard vs full scanner page). */
export type ScannerLoadTuning = {
  maxUniverseSymbols?: number;
  intradayBarLimit?: number;
  /** When true, fetches default watchlist in parallel with gap-intelligence (saves one RTT on the critical path). */
  parallelDefaultWatchlist?: boolean;
  /** Max setups returned by `POST /v1/signals/day/setups` (default 10). Lower = less compute and smaller payload. */
  daySetupsLimit?: number;
  /** When true, loads daily bars and merges `POST /v1/signals/swing/setups` rows (deduped by symbol, then sorted by score). */
  includeSwingDailySetups?: boolean;
  /** Explicit day / swing / both; when set, overrides the boolean `includeSwingDailySetups` alone. */
  scannerSetupLoadMode?: ScannerSetupLoadMode;
  /** Bars per symbol for swing scanner (default 220; backend needs ~205 daily bars for EMA200 logic). */
  swingDailyBarLimit?: number;
  /** Max rows from swing/setups (default 4). */
  swingSetupsLimit?: number;
};

export type DaySetupsRequestExtras = {
  geoScanArticles?: GeoScanArticleInput[];
};

/** Server / RSC path — uses `apiFetch` (session from `next/headers`). */
export async function loadScannerDataWithoutBrief(
  _pdtStatus: PDTStatusPayload | null,
  watchlistSymbols: string[] = [],
  tuning: ScannerLoadTuning | null = null,
  daySetupsExtras: DaySetupsRequestExtras | null = null
): Promise<ScannerCoreData> {
  return runScannerLoadWithoutBrief(
    apiFetch,
    fetchDefaultWatchlistSymbols,
    _pdtStatus,
    watchlistSymbols,
    tuning,
    daySetupsExtras
  );
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
    error: undefined,
    spyPct: core.spyPct,
    qqqPct: core.qqqPct,
    regimeLabel: core.regimeLabel
  };
}
