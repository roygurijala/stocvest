/**
 * Pure helpers, constants, and types for the Watchlists page client.
 * Split out of watchlists-page-client.tsx (which imports them back). No behavior change.
 */
import type { SubscriptionPlan } from "@/lib/api/contracts";
import { colorTokens } from "@/lib/design-system";
import { canonicalUsTicker, canonicalUsTickerFromSearch } from "@/lib/symbol-ticker";
import type {
  WatchlistMaturationRow as MaturationRow,
  WatchlistViewMode
} from "@/lib/watchlist-page-utils";
import {
  presentationMaturationState,
  type SymbolTrackingMap
} from "@/lib/watchlist-tracking-presentation";

type WatchlistRow = {
  watchlist_id: string;
  name: string;
  symbols: string[];
  is_default: boolean;
  symbol_tracking?: SymbolTrackingMap;
};

const QUICK = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA"];

type MaturationAlertFeedItem = {
  title: string;
  created_at: string;
  symbol?: string | null;
  mode?: "swing" | "day";
};

type SymbolCandidate = { symbol: string; label: string };

type WatchlistAddSuggestion = SymbolCandidate & { kind: "watchlist" | "add" };

type ThemeColors = (typeof colorTokens)["dark"];

function parseTickerInput(raw: string): string | null {
  return canonicalUsTickerFromSearch(raw) ?? canonicalUsTicker(raw);
}

function maturationAccent(state: string | undefined, colors: ThemeColors): string {
  switch ((state || "").toLowerCase()) {
    case "actionable":
      return colors.bullish;
    case "developing":
    case "re_evaluating":
      return "#f59e0b";
    case "not_aligned":
      return colors.textMuted;
    case "invalidated":
      return colors.textMuted;
    default:
      return colors.textMuted;
  }
}

function displayStateForSymbol(
  sym: string,
  trackingMap: SymbolTrackingMap | undefined,
  swing: Record<string, MaturationRow>,
  day: Record<string, MaturationRow>,
  dualDesk: boolean
): string | undefined {
  return presentationMaturationState(sym, trackingMap, swing[sym], day[sym], dualDesk);
}

function tradingModeForSignalsNav(viewMode: WatchlistViewMode, dualDesk: boolean): "day" | "swing" {
  if (!dualDesk || viewMode === "swing") return "swing";
  return "day";
}

type WatchlistsPageClientProps = {
  /** Swing + Day Pro (and full access): Swing / Day / Both maturation toggles + dual rows. */
  dualDeskMaturation?: boolean;
  /** Short plan label for the header chip, e.g. ``Swing + Day Pro``. */
  planBadgeLabel?: string;
  /** Canonical subscription tier for assistant context. */
  subscriptionPlan?: SubscriptionPlan;
  /** Plan-based default-watchlist symbol cap (5 / 50 / 100). */
  maxSymbols?: number;
};

export {
  QUICK,
  parseTickerInput,
  maturationAccent,
  displayStateForSymbol,
  tradingModeForSignalsNav,
};
export type {
  WatchlistRow,
  MaturationAlertFeedItem,
  SymbolCandidate,
  WatchlistAddSuggestion,
  ThemeColors,
  WatchlistsPageClientProps,
};
