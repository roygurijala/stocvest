import { apiFetch } from "@/lib/api/client";
import type { PDTStatusPayload } from "@/lib/api/pdt";

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

export async function fetchScannerOverview(pdtStatus: PDTStatusPayload | null): Promise<ScannerOverview> {
  const watchSymbols = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA", "MSFT", "AMZN", "META", "AMD", "GOOGL"];
  const pdtAssessment = pdtStatus?.assessment;

  try {
    const [snapshots, articles, barsBySymbol] = await Promise.all([
      Promise.all(
        watchSymbols.map((symbol) => apiFetch<Record<string, unknown>>(`/v1/market/snapshot?symbol=${symbol}`))
      ),
      apiFetch<Record<string, unknown>[]>("/v1/market/news?limit=20"),
      Promise.all(
        watchSymbols.map(async (symbol) => {
          const bars = await apiFetch<Record<string, unknown>[]>(
            `/v1/market/bars?symbol=${symbol}&timeframe=1min&limit=30`
          );
          return [symbol, bars] as const;
        })
      ).then((rows) => Object.fromEntries(rows))
    ]);

    const cleanSnapshots = snapshots.filter((s): s is Record<string, unknown> => Boolean(s));
    const cleanArticles = (articles || []) as Record<string, unknown>[];
    const cleanBarsBySymbol = Object.fromEntries(
      Object.entries(barsBySymbol).map(([k, v]) => [k, (v || []) as Record<string, unknown>[]])
    );

    const [gaps, catalysts, setups] = await Promise.all([
      apiFetch<GapCandidatePayload[]>("/v1/scanner/gaps", {
        method: "POST",
        body: JSON.stringify({ snapshots: cleanSnapshots, limit: 5, min_abs_gap_percent: 2.0 })
      }),
      apiFetch<CatalystPayload[]>("/v1/scanner/catalysts", {
        method: "POST",
        body: JSON.stringify({ articles: cleanArticles, limit: 5, min_score: 0.35 })
      }),
      apiFetch<IntradaySetupPayload[]>("/v1/signals/day/setups", {
        method: "POST",
        body: JSON.stringify({ bars_by_symbol: cleanBarsBySymbol, limit: 10, min_score: 0.35 })
      })
    ]);

    if (!gaps || !catalysts || !setups) {
      return {
        gaps: [],
        catalysts: [],
        setups: [],
        error: "Service temporarily unavailable. Please try again."
      };
    }

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
