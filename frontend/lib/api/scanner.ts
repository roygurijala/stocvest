import { apiFetch } from "@/lib/api/client";
import type { PDTStatusPayload } from "@/lib/api/pdt";

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
  headline: string;
  category: string;
  sentiment: string;
  score: number;
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

export async function fetchScannerOverview(
  pdtStatus: PDTStatusPayload | null,
  watchlistSymbols: string[] = []
): Promise<ScannerOverview> {
  const pdtAssessment = pdtStatus?.assessment;

  try {
    const gapIntelResp = await apiFetch<{ items: GapIntelligenceItem[]; disclaimer?: string }>(
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
    if (gapIntelResp == null || !Array.isArray(gapIntelResp.items)) {
      return {
        gapIntelligence: [],
        setups: [],
        error: "Service temporarily unavailable. Please try again."
      };
    }

    const gapItems = gapIntelResp.items;
    const gapSyms = gapItems.map((g) => g.symbol.trim().toUpperCase()).filter(Boolean);
    const watchUpper = watchlistSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    let universe = [...new Set([...gapSyms, ...watchUpper])];
    if (universe.length === 0) {
      universe = [...INTRADAY_FALLBACK_SYMBOLS];
    }

    const [snapshotRows, barsBySymbol] = await Promise.all([
      Promise.all(
        universe.map((symbol) => apiFetch<Record<string, unknown>>(`/v1/market/snapshot?symbol=${symbol}`))
      ),
      Promise.all(
        universe.map(async (symbol) => {
          const bars = await apiFetch<Record<string, unknown>[]>(
            `/v1/market/bars?symbol=${symbol}&timeframe=1min&limit=120`
          );
          return [symbol, bars] as const;
        })
      ).then((rows) => Object.fromEntries(rows))
    ]);

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
      const cn = snap.company_name;
      const name = typeof cn === "string" && cn.trim().length ? cn.trim() : undefined;
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

    const setups = await apiFetch<IntradaySetupPayload[]>("/v1/signals/day/setups", {
      method: "POST",
      body: JSON.stringify({
        bars_by_symbol: cleanBarsBySymbol,
        limit: 10,
        min_score: 0.55,
        liquidity_by_symbol: liquidity_by_symbol,
        snapshots_by_symbol,
        regime: regimeForSetups
      })
    });
    if (setups == null) {
      return {
        gapIntelligence: [],
        setups: [],
        error: "Service temporarily unavailable. Please try again."
      };
    }

    const morningBrief = await apiFetch<MorningBriefPayload>("/v1/signals/day/briefing", {
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
          futures_spy_pct: spyPct,
          futures_qqq_pct: qqqPct,
          vix_level: null,
          vix_direction: "flat",
          regime: regimeLabel,
          economic_events: [],
          earnings_today: [],
          gap_intelligence_items: gapItems,
          intraday_setups: setups
        }
      })
    });

    return { gapIntelligence: gapItems, setups, morningBrief: morningBrief || undefined };
  } catch (error: unknown) {
    return {
      gapIntelligence: [],
      setups: [],
      error: error instanceof Error ? error.message : "Unable to connect. Check your connection."
    };
  }
}
