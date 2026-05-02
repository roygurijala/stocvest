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

export interface GapCandidatePayload {
  symbol: string;
  gap_percent: number;
  day_volume: number;
  rank_score: number;
  direction: string;
}

export interface CatalystPayload {
  article_id: string;
  symbol: string;
  title: string;
  catalyst_type: string;
  direction: string;
  catalyst_score: number;
}

export interface IntradaySetupPayload {
  symbol: string;
  direction: string;
  score: number;
  triggers: string[];
  timestamp_iso: string;
  disclaimer?: string;
  company_name?: string;
}

export interface ScannerBriefingPayload {
  date_iso: string;
  title: string;
  markdown: string;
  disclaimer?: string;
}

export interface ScannerOverview {
  gaps: GapCandidatePayload[];
  catalysts: CatalystPayload[];
  setups: IntradaySetupPayload[];
  briefing?: ScannerBriefingPayload;
  error?: string;
}

export async function fetchScannerOverview(
  pdtStatus: PDTStatusPayload | null,
  watchlistSymbols: string[] = []
): Promise<ScannerOverview> {
  const pdtAssessment = pdtStatus?.assessment;

  try {
    const gapsFull = await apiFetch<GapCandidatePayload[]>("/v1/scanner/gaps", {
      method: "POST",
      body: JSON.stringify({
        snapshots: [],
        limit: 20,
        min_abs_gap_percent: 2.0,
        min_day_volume: 500_000
      })
    });
    if (gapsFull == null) {
      return {
        gaps: [],
        catalysts: [],
        setups: [],
        error: "Service temporarily unavailable. Please try again."
      };
    }

    const gapSyms = gapsFull.map((g) => g.symbol.trim().toUpperCase()).filter(Boolean);
    const watchUpper = watchlistSymbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    let universe = [...new Set([...gapSyms, ...watchUpper])];
    if (universe.length === 0) {
      universe = [...INTRADAY_FALLBACK_SYMBOLS];
    }

    const [articles, snapshotRows, barsBySymbol] = await Promise.all([
      apiFetch<Record<string, unknown>[]>("/v1/market/news?limit=20"),
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

    const cleanArticles = (articles || []) as Record<string, unknown>[];
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
      const adv =
        typeof prevVol === "number" && Number.isFinite(prevVol) ? prevVol : null;
      const lastRaw = snap.last_trade_price ?? snap.day_open;
      const last =
        typeof lastRaw === "number" && Number.isFinite(lastRaw) ? lastRaw : null;
      const cn = snap.company_name;
      const name = typeof cn === "string" && cn.trim().length ? cn.trim() : undefined;
      liquidity_by_symbol[sym] = {
        avg_daily_volume: adv,
        last_price: last,
        ...(name ? { company_name: name } : {})
      };
    });

    const [catalysts, setups] = await Promise.all([
      apiFetch<CatalystPayload[]>("/v1/scanner/catalysts", {
        method: "POST",
        body: JSON.stringify({ articles: cleanArticles, limit: 5, min_score: 0.35 })
      }),
      apiFetch<IntradaySetupPayload[]>("/v1/signals/day/setups", {
        method: "POST",
        body: JSON.stringify({
          bars_by_symbol: cleanBarsBySymbol,
          limit: 10,
          min_score: 0.5,
          liquidity_by_symbol: liquidity_by_symbol
        })
      })
    ]);
    if (catalysts == null || setups == null) {
      return {
        gaps: [],
        catalysts: [],
        setups: [],
        error: "Service temporarily unavailable. Please try again."
      };
    }

    const gaps = [...gapsFull]
      .filter((g) => typeof g.gap_percent === "number" && Number.isFinite(g.gap_percent))
      .sort((a, b) => Math.abs(b.gap_percent) - Math.abs(a.gap_percent))
      .slice(0, 10);

    const briefing = await apiFetch<ScannerBriefingPayload>("/v1/signals/day/briefing", {
      method: "POST",
      body: JSON.stringify({
        briefing_date: new Date().toISOString().slice(0, 10),
        gap_candidates: gaps,
        news_catalysts: catalysts,
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
        market_session_summary: "Frontend scanner summary"
      })
    });

    return { gaps, catalysts, setups, briefing: briefing || undefined };
  } catch (error: unknown) {
    return {
      gaps: [],
      catalysts: [],
      setups: [],
      error: error instanceof Error ? error.message : "Unable to connect. Check your connection."
    };
  }
}
