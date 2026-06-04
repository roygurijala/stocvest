/**
 * Pure helpers, constants, and types for the Signals page client.
 * Split out of signals-page-client.tsx (which re-imports them). No behavior change.
 */

import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { ThemeColors } from "@/lib/design-system";
import { signalLayerDisplayName } from "@/lib/signals/layer-display-names";
import { canonicalUsTicker, canonicalUsTickerFromSearch } from "@/lib/symbol-ticker";

type LayerStatus = "Bullish" | "Bearish" | "Neutral" | "Unavailable" | "As of close";

interface LayerRow {
  icon: string;
  name: string;
  status: LayerStatus;
  /** When set, shown instead of `status` (e.g. sector cache pending — not neutral). */
  statusLabel?: string;
  /** Sector mapper cache still warming; excluded from composite — not "stale close" data. */
  sectorCachePending?: boolean;
  explanation: string;
  score: number;
}

export type SignalsPagePrefill = {
  /** From `?symbol=` when `ref` is an allowlisted in-app deep link (scanner, watchlist, dashboard*, etc.). */
  urlSymbol: string | null;
  /** When `?signal_id=` is present but server could not resolve ticker; client fetches me/records. */
  signalIdForResolve: string | null;
  /** URL contained `signal_id` (strip query after symbol is committed). */
  hadSignalIdQuery: boolean;
  /**
   * Mode Separation safety perimeter (assistant_prompts.py): when present,
   * `?trading_mode=swing|day` in the URL is the authoritative source of the
   * page's trading mode and OVERRIDES localStorage. `null` means the URL did
   * not specify a mode, so the client falls back to localStorage / default.
   */
  initialTradingMode: "day" | "swing" | null;
  /** From `?ref=` — preserved for contextual back navigation after URL cleanup. */
  navigationRef: string | null;
};

interface SignalsPageClientProps {
  marketOverview: MarketOverview;
  scannerOverview: ScannerOverview;
  /** Default-list symbols for typeahead (SSR). Earnings load per symbol on the client. */
  defaultWatchlistSymbols?: string[];
  signalsPrefill?: SignalsPagePrefill;
  /** Swing Pro hides intraday engine UI; server coerces deep-links the same way. */
  dayTradingSurfaces?: boolean;
}

const SIGNALS_SESSION_SYMBOL_KEY = "stocvest_signals_session_symbol";

function readNavigationRefFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const ref = new URL(window.location.href).searchParams.get("ref");
    return ref?.trim() || null;
  } catch {
    return null;
  }
}

type SymbolCandidate = { symbol: string; label: string };

function parseTickerInput(raw: string): string | null {
  return canonicalUsTickerFromSearch(raw) ?? canonicalUsTicker(raw);
}

const layerMeta = [
  ["📊", "Technical"],
  ["📰", "News"],
  ["🌍", "Macro"],
  ["🏭", "Sector"],
  ["🌐", "Geopolitical"],
  ["📈", signalLayerDisplayName("internals")]
] as const;

const SIGNAL_LAYER_KEYS = ["technical", "news", "macro", "sector", "geopolitical", "internals"] as const;

const TRADING_MODE_STORAGE_KEY = "stocvest_trading_mode";
type TradingMode = "day" | "swing";

/** Short axis labels so radar ticks do not truncate in the Layers tab. */
const RADAR_LAYER_SHORT: Record<string, string> = {
  technical: "Tech",
  news: "News",
  macro: "Macro",
  sector: "Sector",
  geopolitical: "Geo",
  internals: "Intl"
};

/** Marginal bullish internals vs clearly bearish technical — reconciliation copy only in this band (fixed, no UI tuning). */
const INTERNALS_LEAN_BULLISH_MAX_SCORE = 65;
/** Technical layer score at/below this = “clearly bearish structure” for reconciliation (avoids borderline Bearish labels). */
const TECHNICAL_CLEAR_BEARISH_MAX_SCORE = 45;

function macroVerdictContextNote(status: LayerStatus): string {
  if (status === "Bullish") return "Macro conditions broadly supportive of risk assets.";
  if (status === "Bearish") return "Elevated macro risk constrains risk appetite despite local signals.";
  if (status === "Neutral") return "Mixed macro inputs; no dominant economic tailwind or headwind.";
  return "Macro gauges backdrop and event risk; when coverage is limited, treat this row as context, not a trade trigger.";
}

function snapshotHasTradeableLast(s: SnapshotPayload | null | undefined): boolean {
  return (
    s != null &&
    typeof s.last_trade_price === "number" &&
    Number.isFinite(s.last_trade_price) &&
    s.last_trade_price > 0
  );
}

function statusColor(status: LayerStatus, colors: ThemeColors): string {
  if (status === "Bullish") return colors.bullish;
  if (status === "Bearish") return colors.bearish;
  if (status === "Neutral") return colors.caution;
  if (status === "As of close") return colors.text;
  return colors.textMuted;
}

function verdictToLayerStatus(verdict: string, status: string): LayerStatus {
  const s = status.toLowerCase();
  if (s === "unavailable") {
    const v = verdict.toLowerCase();
    if (v === "bullish" || v === "bearish" || v === "neutral") {
      return "As of close";
    }
    return "Unavailable";
  }
  const v = verdict.toLowerCase();
  if (v === "bullish") return "Bullish";
  if (v === "bearish") return "Bearish";
  return "Neutral";
}

export {
  SIGNALS_SESSION_SYMBOL_KEY,
  readNavigationRefFromUrl,
  parseTickerInput,
  layerMeta,
  SIGNAL_LAYER_KEYS,
  TRADING_MODE_STORAGE_KEY,
  RADAR_LAYER_SHORT,
  INTERNALS_LEAN_BULLISH_MAX_SCORE,
  TECHNICAL_CLEAR_BEARISH_MAX_SCORE,
  macroVerdictContextNote,
  snapshotHasTradeableLast,
  statusColor,
  verdictToLayerStatus,
};
export type {
  LayerStatus,
  LayerRow,
  SignalsPageClientProps,
  SymbolCandidate,
  TradingMode,
};
