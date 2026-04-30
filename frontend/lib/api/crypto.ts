import { apiFetch } from "@/lib/api/client";

export interface CryptoBar {
  symbol: string;
  timestamp: string;
  close: number;
  volume: number;
}

export interface CryptoOverview {
  symbol: string;
  latestPrice?: number;
  latestVolume?: number;
  bars: CryptoBar[];
  delayed: false;
  onChainMetricsIncluded: false;
  error?: string;
}

export async function fetchCryptoOverview(symbol: string = "X:BTCUSD"): Promise<CryptoOverview> {
  try {
    const bars = await apiFetch<CryptoBar[]>(
      `/v1/market/bars?symbol=${encodeURIComponent(symbol)}&timeframe=1min&limit=30`
    );
    if (!bars) {
      return {
        symbol,
        bars: [],
        delayed: false,
        onChainMetricsIncluded: false,
        error: "Service temporarily unavailable. Please try again."
      };
    }
    const latest = bars[bars.length - 1];
    return {
      symbol,
      latestPrice: latest?.close,
      latestVolume: latest?.volume,
      bars,
      delayed: false,
      onChainMetricsIncluded: false
    };
  } catch (error: unknown) {
    return {
      symbol,
      bars: [],
      delayed: false,
      onChainMetricsIncluded: false,
      error: error instanceof Error ? error.message : "Unable to connect. Check your connection."
    };
  }
}
