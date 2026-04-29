import { apiFetch } from "@/lib/api/client";

export interface OptionChainRow {
  symbol: string;
  underlying: string;
  expiration: string;
  strike: number;
  option_type: string;
  bid?: number | null;
  ask?: number | null;
  last_price?: number | null;
  volume?: number | null;
  open_interest?: number | null;
  implied_volatility?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
}

export interface OptionChainOverview {
  symbol: string;
  rows: OptionChainRow[];
  delayedByMinutes: number;
  error?: string;
}

export async function fetchOptionChainOverview(symbol: string = "AAPL"): Promise<OptionChainOverview> {
  try {
    const rows = await apiFetch<OptionChainRow[]>(
      `/v1/market/options?symbol=${encodeURIComponent(symbol)}&limit=30`
    );
    return { symbol, rows, delayedByMinutes: 15 };
  } catch (error: unknown) {
    return {
      symbol,
      rows: [],
      delayedByMinutes: 15,
      error: error instanceof Error ? error.message : "Unknown options API error."
    };
  }
}
