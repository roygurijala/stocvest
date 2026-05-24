"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { useSignalComposite } from "@/lib/hooks/use-signal-composite";
import { useSignalsMountRevalidate } from "@/lib/hooks/use-signals-mount-revalidate";
import { useGapIntel } from "@/lib/hooks/use-gap-intel";
import { useSymbolNews } from "@/lib/hooks/use-symbol-news";
import { useSymbolSnapshot } from "@/lib/hooks/use-symbol-snapshot";
import type { MarketOverview, NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import { fetchEarningsCalendarClient } from "@/lib/api/earnings-client";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { APP_TOP_BAR_LAYOUT_HEIGHT } from "@/components/top-bar";
import { SignalsCommandBar } from "@/components/signals/signals-command-bar";
import { SignalsDeskKpiStrip } from "@/components/signals/signals-desk-kpi-strip";
import { SignalsDeskTabNav } from "@/components/signals/signals-desk-tab-nav";
import { SignalsExecutionContextStrip } from "@/components/signals/signals-execution-context-strip";
import { SignalsFormingBanner } from "@/components/signals/signals-forming-banner";
import { SignalsRadarPanel } from "@/components/signals/signals-radar-panel";
import { CausalNarrativePanel } from "@/components/signals/causal-narrative-panel";
import { TimeframeContextPanel } from "@/components/signals/timeframe-context-panel";
import { SignalsWhyNotPanel } from "@/components/signals/signals-why-not-panel";
import { SignalsBiasRationalePanel } from "@/components/signals/signals-bias-rationale-panel";
import { resolveCausalNarrative } from "@/lib/signal-evidence/causal-narrative";
import { isTickerSearchQueryReady } from "@/lib/ticker-search-query";
import {
  isTimeframeCounterTrend,
  resolveTimeframeContext
} from "@/lib/signal-evidence/timeframe-context";
import { SIGNALS_SECTION_TARGET, scrollToSignalsSection } from "@/lib/signals-page-sections";
import { buildSignalsDeskKpiItems } from "@/lib/signals-desk-kpi-present";
import {
  kpiTargetScrollId,
  kpiTargetToDeskTab,
  parseSignalsDeskTab,
  SIGNALS_TAB_QUERY_KEY,
  type SignalsDeskTab,
  type SignalsKpiTarget
} from "@/lib/signals-page-tabs";
import { SignalsLayerBreakdown } from "@/components/signals/signals-layer-breakdown";
import { SignalsWatchlistPickerModal } from "@/components/signals/signals-watchlist-picker-modal";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { normalizeWatchlistMaturationBySymbol } from "@/lib/watchlist-page-utils";
import { SignalsReferenceLevels } from "@/components/signals/signals-reference-levels";
import { SignalsSetupRead } from "@/components/signals/signals-setup-read";
import { buildFundamentalBackdropSummary } from "@/lib/signal-evidence/fundamental-present";
import { parseFundamentalContext } from "@/lib/signal-evidence";
import { useHasAIExplanations, useUserProfileLoaded } from "@/lib/api/user";
import { SetupEvolutionPanel } from "@/components/signals/setup-evolution-panel";
import { ScenarioBuilderInline } from "@/components/scenario-builder/scenario-builder-inline";
import { buildScenarioPlanningBundle } from "@/lib/scenario/scenario-planning-bundle";
import type { ScenarioBuilderDrillDown } from "@/lib/scenario/scenario-builder-drill-down";
import { useWatchlistMaturationLine } from "@/lib/hooks/use-watchlist-maturation-line";
import { buildSignalEvaluationFreshness } from "@/lib/signals-evaluation-present";
import { buildSignalsDeskPriceContext } from "@/lib/signals-desk-price-present";
import {
  buildSignalsPageDecision,
  formatSignalsAlignmentDisplayLine,
  layerDeltaVsBaseline,
  normalizeSetupBias,
  pickPreviewLayers,
  resolveSignalsLayerAlignment,
  SIGNAL_LAYER_LEVEL_BASELINE,
  type SignalsLayerRowInput
} from "@/lib/signals-page-present";
import { isRrBelowVerdictThreshold } from "@/lib/trade-conviction-tier";
import {
  resolveScenarioBuilderCapability,
  type ScenarioReadinessContext
} from "@/lib/scenario/scenario-readiness";
import { buildScenarioPreviewPanelData } from "@/lib/scenario/scenario-preview-panels";
import { CuteLoader } from "@/components/cute-loader";
import { SignalsAfterHoursPanel } from "@/components/signals-after-hours-panel";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { NewsPanel } from "@/components/news-panel";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { useIsMobileLayout } from "@/lib/hooks/use-is-mobile-layout";
import { coerceSnapshotForReferenceLevels, deriveSessionReferenceLevels } from "@/lib/snapshot-reference-levels";
import {
  applySwingCompositeEnrichment,
  buildEvidenceFromSetup,
  parseCompositeAlignment,
  parseSwingCompositeInsight,
  type SignalEvidenceData
} from "@/lib/signal-evidence";
import { buildRankedSymbolSuggestions } from "@/lib/symbol-typeahead";
import {
  canonicalUsTicker,
  canonicalUsTickerFromSearch,
  isWellFormedUsTicker,
  tickersEquivalent
} from "@/lib/symbol-ticker";
import { WATCHLIST_SYMBOLS_CHANGED_EVENT } from "@/lib/watchlist-membership-client";
import { LAYER_NAME_HINTS } from "@/lib/ui-tooltips";
import { isInsufficientCompositeResponse, type SwingCompositeMarketStatus } from "@/lib/api/swing-composite";
import { synthTradeDecision } from "@/lib/signal-evidence/trade-decision";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { narrowGapIntelForAssistant } from "@/lib/assistant/gap-intel-context";
import type { AssistantPageContext, AssistantLayerKey, AssistantLayerStatus } from "@/lib/assistant/types";

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
  /** From `?symbol=&ref=scanner|watchlist|validation|journal` only. */
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
  ["📈", "Internals"]
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

export function SignalsPageClient({
  marketOverview,
  scannerOverview,
  defaultWatchlistSymbols = [],
  signalsPrefill = {
    urlSymbol: null,
    signalIdForResolve: null,
    hadSignalIdQuery: false,
    initialTradingMode: null
  },
  dayTradingSurfaces = true
}: SignalsPageClientProps) {
  const { colors, theme } = useTheme();
  const [earningsBySymbol, setEarningsBySymbol] = useState<Record<string, EarningsEvent>>({});
  const isMobileLayout = useIsMobileLayout();
  const symbolComboRef = useRef<HTMLDivElement | null>(null);
  const evolutionPanelRef = useRef<HTMLDivElement | null>(null);
  const scrollToSetupEvolution = useCallback(() => {
    const el = document.getElementById(SIGNALS_SECTION_TARGET.evolution);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const signalIdUrlStrippedRef = useRef(false);
  const pendingAutoEvidenceOpenRef = useRef(false);
  const [tradingMode, setTradingMode] = useState<TradingMode>(() => {
    const raw = signalsPrefill.initialTradingMode;
    const base: TradingMode = raw === "day" || raw === "swing" ? raw : "swing";
    return dayTradingSurfaces ? base : "swing";
  });
  const [symbol, setSymbol] = useState(() => signalsPrefill.urlSymbol ?? "");
  const [symbolDraft, setSymbolDraft] = useState(() => signalsPrefill.urlSymbol ?? "");
  const [resumedFromSession, setResumedFromSession] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestHighlight, setSuggestHighlight] = useState(0);
  const [watchlistPickerOpen, setWatchlistPickerOpen] = useState(false);
  const [watchlistPickerSyms, setWatchlistPickerSyms] = useState<string[]>([]);
  const [watchlistPickerMaturation, setWatchlistPickerMaturation] = useState<
    Record<string, WatchlistMaturationRow>
  >({});
  const [watchlistPickerLoading, setWatchlistPickerLoading] = useState(false);
  /**
   * Symbols on the user's default watchlist — used as one of four corroboration sources for the
   * symbol input (alongside scanner setups / market overview snapshots / Polygon reference search).
   * A typed-in ticker that doesn't appear in any of those is treated as unverified and is NOT
   * auto-committed; the user sees a calm one-line caution under the input.
   */
  const [userWatchlistSyms, setUserWatchlistSyms] = useState<string[]>([]);
  const [remoteCandidates, setRemoteCandidates] = useState<SymbolCandidate[]>([]);
  const [remoteSearchLoading, setRemoteSearchLoading] = useState(false);
  const [remoteSearchError, setRemoteSearchError] = useState<string | null>(null);
  /** Calm caution shown under the symbol input when free-text submission lacks corroboration. */
  const [unverifiedSymbolNote, setUnverifiedSymbolNote] = useState<string | null>(null);
  const [signalEvidence, setSignalEvidence] = useState<SignalEvidenceData | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [newsPanelSymbol, setNewsPanelSymbol] = useState("");
  const [newsPanelOpen, setNewsPanelOpen] = useState(false);
  const [newsUiTick, setNewsUiTick] = useState(0);
  const [deskTab, setDeskTab] = useState<SignalsDeskTab>("setup");
  const [deskKpiScrollTarget, setDeskKpiScrollTarget] = useState<SignalsKpiTarget | null>(null);
  // Tier 1 → Layer 4: per-symbol snapshot is now backed by SWR.
  // The cache lives under `stocvest:symbol-snapshot:<TICKER>` and
  // returns stale data instantly on repeat visits while silently
  // refreshing in the background. We pass `""` (which SWR treats
  // as "skip") whenever the market overview already carries the
  // snapshot for the current symbol — preserving the original
  // semantics (`useEffect` used to short-circuit in that case).
  // See `lib/hooks/use-symbol-snapshot.ts` for the full rationale.
  const symbolForSwr = useMemo(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return "";
    const inOverview = marketOverview.snapshots.some((s) => s.symbol === sym);
    return inOverview ? "" : sym;
  }, [symbol, marketOverview.snapshots]);
  const { snapshot: symbolSnapshot } = useSymbolSnapshot(symbolForSwr);
  // Layer 4 (second slice): per-symbol composite is now SWR-cached.
  // The hook re-fetches when (symbol, mode) changes; the Layers /
  // History tab toggle gates via `enabled` so the History tab
  // never fires a composite call. `keepPreviousData: false`
  // overrides the global default so the screen-clear UX on
  // mode-pill toggle (a previous user request) survives the cache
  // layer — the new mode's pill never renders alongside the
  // previous mode's 6-layer breakdown / radar / evidence.
  const {
    composite: compositeResult,
    isInitialLoading: compositeInitialLoading,
    isRevalidating: compositeRevalidating,
    transportError: compositeTransportError,
    fetchErrorMessage: compositeFetchErrorMessage
  } = useSignalComposite(symbol, tradingMode, {
    enabled: symbol.trim().length > 0
  });
  const { isMountRevalidating } = useSignalsMountRevalidate(symbol, tradingMode, symbol.trim().length > 0);
  const [afterHoursInWatchlist, setAfterHoursInWatchlist] = useState(false);
  const [afterHoursWatchlistKnown, setAfterHoursWatchlistKnown] = useState(false);

  const symbolCommitted = symbol.trim().length > 0;

  const { snapshot: gapIntelSnapshot } = useGapIntel(symbol, tradingMode, {
    enabled: symbol.trim().length > 0 && symbolCommitted
  });
  const symbolCandidates = useMemo(() => {
    const m = new Map<string, SymbolCandidate>();
    const add = (sym: string, name?: string | null) => {
      const u = canonicalUsTicker(sym);
      if (!u) return;
      const n = (name ?? "").trim();
      const label = n ? `${u} — ${n}` : u;
      if (!m.has(u)) m.set(u, { symbol: u, label });
    };
    for (const s of scannerOverview.setups) {
      add(s.symbol, s.company_name ?? null);
    }
    for (const g of scannerOverview.gapIntelligence) {
      add(g.symbol, g.company_name);
    }
    for (const snap of marketOverview.snapshots) {
      add(snap.symbol, snap.company_name ?? null);
    }
    for (const sym of defaultWatchlistSymbols) {
      add(sym, null);
    }
    return Array.from(m.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [scannerOverview.setups, scannerOverview.gapIntelligence, marketOverview.snapshots, defaultWatchlistSymbols]);

  useEffect(() => {
    if (!symbolCommitted) return;
    const sym = symbol.trim().toUpperCase();
    let cancelled = false;
    void fetchEarningsCalendarClient([sym], 3).then((res) => {
      if (cancelled) return;
      const hit = [...res.upcoming, ...res.recent].find((e) => e.symbol.trim().toUpperCase() === sym);
      if (!hit) return;
      setEarningsBySymbol((prev) => (prev[sym] ? prev : { ...prev, [sym]: hit }));
    });
    return () => {
      cancelled = true;
    };
  }, [symbol, symbolCommitted]);

  useEffect(() => {
    const q = symbolDraft.trim();
    if (!isTickerSearchQueryReady(q)) {
      setRemoteCandidates([]);
      setRemoteSearchLoading(false);
      setRemoteSearchError(null);
      return;
    }
    let cancelled = false;
    setRemoteSearchLoading(true);
    setRemoteSearchError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/stocvest/market/tickers-search?q=${encodeURIComponent(q)}`, {
            credentials: "same-origin",
            cache: "no-store"
          });
          if (cancelled) return;
          if (!res.ok) {
            setRemoteSearchError(`Search failed (${res.status}). Try a known symbol.`);
            setRemoteCandidates([]);
            return;
          }
          const j = (await res.json().catch(() => ({}))) as { items?: unknown; error?: unknown };
          const items = Array.isArray(j.items) ? j.items : [];
          const next: SymbolCandidate[] = [];
          for (const it of items) {
            if (!it || typeof it !== "object") continue;
            const o = it as { symbol?: unknown; name?: unknown };
            const sym = parseTickerInput(String(o.symbol ?? ""));
            if (!sym) continue;
            const name = String(o.name ?? "").trim();
            next.push({ symbol: sym, label: name ? `${sym} — ${name}` : sym });
          }
          const bodyError = typeof j.error === "string" ? j.error.trim() : "";
          if (!cancelled) {
            setRemoteCandidates(next);
            setRemoteSearchError(next.length === 0 && bodyError ? bodyError : null);
          }
        } catch {
          if (!cancelled) {
            setRemoteCandidates([]);
            setRemoteSearchError("Network error while searching tickers.");
          }
        } finally {
          if (!cancelled) setRemoteSearchLoading(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setRemoteSearchLoading(false);
    };
  }, [symbolDraft]);

  const suggestionRows = useMemo(() => {
    const q = symbolDraft.trim();
    // No query yet — show the first chunk of the local pool so the
    // dropdown isn't empty when the user clicks into the input.
    if (!q) return symbolCandidates.slice(0, 8);
    // With a query we apply the shared ticker-first ranker
    // (`rankSymbolCandidates`) to BOTH the local and the remote
    // (Polygon) candidates so the merged list ends up consistently
    // ordered: exact symbol → symbol prefix → symbol contains →
    // company-name contains. Without ranking remote rows the same
    // way, a remote `AAPL — Apple` could slip in front of a local
    // `APP — AppLovin` for query "AP", which is the bug the user
    // reported.
    const seen = new Set<string>();
    const merged: SymbolCandidate[] = [];
    for (const c of [...symbolCandidates, ...remoteCandidates]) {
      const sym = c.symbol.toUpperCase();
      if (seen.has(sym)) continue;
      seen.add(sym);
      merged.push(c);
    }
    return buildRankedSymbolSuggestions(merged, q, 12);
  }, [symbolCandidates, symbolDraft, remoteCandidates]);

  const applyCommittedSymbol = useCallback((sym: string | null | undefined) => {
    const t = parseTickerInput(String(sym ?? ""));
    if (!t) {
      setSymbol("");
      setSymbolDraft("");
      setSuggestOpen(false);
      // Layer 4 second slice: `compositeResult` and `radarData` are
      // derived from the SWR-backed `useSignalComposite` hook now.
      // Clearing the symbol produces an empty SWR cache key, the
      // hook returns `composite: null`, and `radarData` falls out
      // via its `useMemo` derivation — no imperative setters needed.
      setSignalEvidence(null);
      setResumedFromSession(false);
      setDeskTab("setup");
      try {
        sessionStorage.removeItem(SIGNALS_SESSION_SYMBOL_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    setSymbol(t);
    setSymbolDraft(t);
    setSuggestOpen(false);
    setUnverifiedSymbolNote(null);
    setResumedFromSession(false);
    setDeskTab("setup");
  }, []);

  /**
   * Fetch the user's default watchlist once so we can corroborate typed-in tickers without
   * hitting the network on every keystroke. Best-effort: if the request fails the watchlist
   * source simply contributes no matches; remote Polygon search still gates free-text commits.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stocvest/watchlists/default/symbols", { method: "GET" });
        if (!res.ok || cancelled) return;
        const data = (await res.json().catch(() => ({}))) as { symbols?: unknown };
        const list = Array.isArray(data.symbols)
          ? data.symbols
              .map((x) => canonicalUsTicker(String(x)))
              .filter((x): x is string => Boolean(x))
          : [];
        if (!cancelled) setUserWatchlistSyms(list);
      } catch {
        /* watchlist is one of four corroboration sources; failure is non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void (async () => {
        try {
          const res = await fetch("/api/stocvest/watchlists/default/symbols", { method: "GET" });
          if (!res.ok || cancelled) return;
          const data = (await res.json().catch(() => ({}))) as { symbols?: unknown };
          const list = Array.isArray(data.symbols)
            ? data.symbols
                .map((x) => canonicalUsTicker(String(x)))
                .filter((x): x is string => Boolean(x))
            : [];
          if (!cancelled) setUserWatchlistSyms(list);
        } catch {
          /* non-fatal */
        }
      })();
    };
    window.addEventListener(WATCHLIST_SYMBOLS_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(WATCHLIST_SYMBOLS_CHANGED_EVENT, reload);
    };
  }, []);

  /**
   * A symbol is "corroborated" when at least one trustworthy source recognizes it, in line with
   * STOCVEST's intentionality-over-permissiveness principle:
   *   1. Scanner setups / gap intel / market overview snapshots (already in `symbolCandidates`).
   *   2. The user's default watchlist.
   *   3. Polygon reference search results in `remoteCandidates`.
   * `applyCommittedSymbol` is called directly from typeahead picks (1+3) and the watchlist picker
   * (2), which are corroborated by construction. The gate matters for free-text Enter/blur.
   */
  const isSymbolCorroborated = useCallback(
    (sym: string): boolean => {
      const u = canonicalUsTicker(sym) ?? parseTickerInput(sym);
      if (!u) return false;
      if (symbolCandidates.some((c) => tickersEquivalent(c.symbol, u))) return true;
      if (remoteCandidates.some((c) => tickersEquivalent(c.symbol, u))) return true;
      if (userWatchlistSyms.some((s) => tickersEquivalent(s, u))) return true;
      return false;
    },
    [symbolCandidates, remoteCandidates, userWatchlistSyms]
  );

  const canCommitTicker = useCallback(
    (raw: string): boolean => {
      const t = parseTickerInput(raw);
      if (!t) return false;
      return isSymbolCorroborated(t) || isWellFormedUsTicker(raw);
    },
    [isSymbolCorroborated]
  );

  /** Calm one-line caption used under the symbol input — kept in code so wording lives in one place. */
  const buildUnverifiedSymbolNote = useCallback(
    (sym: string): string =>
      `No session data found for "${sym}". Verify the ticker or choose from the suggestions above.`,
    []
  );

  const openWatchlistPicker = useCallback(async () => {
    setWatchlistPickerOpen(true);
    setWatchlistPickerLoading(true);
    try {
      const mode = tradingMode;
      const [symRes, matRes] = await Promise.all([
        fetch("/api/stocvest/watchlists/default/symbols", { method: "GET" }),
        fetch(`/api/stocvest/watchlists/maturation-summary?mode=${encodeURIComponent(mode)}`, {
          cache: "no-store"
        })
      ]);
      const data = (await symRes.json().catch(() => ({}))) as { symbols?: string[] };
      const list = Array.isArray(data.symbols)
        ? data.symbols.map((x) => String(x)).map((x) => canonicalUsTicker(x)).filter((x): x is string => Boolean(x))
        : [];
      setWatchlistPickerSyms(list);
      if (matRes.ok) {
        const matJson = await matRes.json().catch(() => ({}));
        setWatchlistPickerMaturation(normalizeWatchlistMaturationBySymbol(matJson));
      } else {
        setWatchlistPickerMaturation({});
      }
    } catch {
      setWatchlistPickerSyms([]);
      setWatchlistPickerMaturation({});
    } finally {
      setWatchlistPickerLoading(false);
    }
  }, [tradingMode]);

  const rawSnapshot = useMemo(() => {
    const sym = symbol.toUpperCase();
    return marketOverview.snapshots.find((s) => s.symbol === sym) ?? symbolSnapshot;
  }, [marketOverview.snapshots, symbol, symbolSnapshot]);

  const deskPriceContext = useMemo(
    () => buildSignalsDeskPriceContext(rawSnapshot ?? undefined),
    [rawSnapshot]
  );

  const snapshot = useMemo(() => coerceSnapshotForReferenceLevels(rawSnapshot), [rawSnapshot]);

  useEffect(() => {
    if (!dayTradingSurfaces) setTradingMode("swing");
  }, [dayTradingSurfaces]);

  useEffect(() => {
    if (dayTradingSurfaces) return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("trading_mode") !== "day") return;
      url.searchParams.set("trading_mode", "swing");
      const q = url.searchParams.toString();
      window.history.replaceState(null, "", `${url.pathname}${q ? `?${q}` : ""}`);
    } catch {
      /* ignore */
    }
  }, [dayTradingSurfaces]);

  useEffect(() => {
    // URL-driven trading_mode takes precedence over localStorage. Skip the
    // localStorage restore when the user landed here via a deep link that
    // specified the mode explicitly — per the Mode Separation rule, that URL
    // is the authoritative source for the engine that owns this view.
    if (signalsPrefill.initialTradingMode != null) return;
    try {
      const raw = localStorage.getItem(TRADING_MODE_STORAGE_KEY);
      if (raw === "swing" || (raw === "day" && dayTradingSurfaces)) setTradingMode(raw);
    } catch {
      /* ignore */
    }
  }, [signalsPrefill.initialTradingMode, dayTradingSurfaces]);

  useEffect(() => {
    try {
      const tab = parseSignalsDeskTab(new URL(window.location.href).searchParams.get(SIGNALS_TAB_QUERY_KEY));
      setDeskTab(tab);
    } catch {
      /* ignore */
    }
  }, []);

  const applyDeskTab = useCallback((tab: SignalsDeskTab) => {
    setDeskTab(tab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(SIGNALS_TAB_QUERY_KEY, tab);
      window.history.replaceState(null, "", url.pathname + (url.search || ""));
    } catch {
      /* ignore */
    }
  }, []);

  const applyDeskKpiTarget = useCallback(
    (target: SignalsKpiTarget) => {
      applyDeskTab(kpiTargetToDeskTab(target));
      setDeskKpiScrollTarget(target);
    },
    [applyDeskTab]
  );

  useEffect(() => {
    if (signalsPrefill.urlSymbol || signalsPrefill.signalIdForResolve) return;
    try {
      const s = sessionStorage.getItem(SIGNALS_SESSION_SYMBOL_KEY);
      const sym = s ? canonicalUsTicker(s) : null;
      if (sym) {
        setSymbol(sym);
        setSymbolDraft(sym);
        setResumedFromSession(true);
      }
    } catch {
      /* ignore */
    }
  }, [signalsPrefill.urlSymbol, signalsPrefill.signalIdForResolve]);

  useEffect(() => {
    const id = signalsPrefill.signalIdForResolve?.trim();
    if (!id) return;
    if (symbol.trim()) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/stocvest/signals/me/records/${encodeURIComponent(id)}`, { method: "GET" });
        if (!res.ok || cancelled) return;
        const data = (await res.json().catch(() => null)) as { symbol?: unknown } | null;
        const raw = data && typeof data === "object" && typeof data.symbol === "string" ? data.symbol : "";
        const sym = canonicalUsTicker(raw);
        if (sym && !cancelled) applyCommittedSymbol(sym);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signalsPrefill.signalIdForResolve, symbol, applyCommittedSymbol]);

  useEffect(() => {
    if (signalIdUrlStrippedRef.current) return;
    if (!signalsPrefill.hadSignalIdQuery) return;
    const sym = symbol.trim();
    if (!sym) return;
    signalIdUrlStrippedRef.current = true;
    try {
      // Strip `signal_id` (and any other transient query like `ref`) but
      // preserve `trading_mode` so the engine attribution survives the URL
      // cleanup. The Mode Separation rule treats trading_mode as authoritative
      // state, not transient nav state.
      const next = new URLSearchParams();
      const mode = new URL(window.location.href).searchParams.get("trading_mode");
      if (mode === "swing" || (mode === "day" && dayTradingSurfaces)) next.set("trading_mode", mode);
      const suffix = next.toString() ? `?${next.toString()}` : "";
      window.history.replaceState(null, "", `/dashboard/signals${suffix}`);
    } catch {
      /* ignore */
    }
  }, [symbol, signalsPrefill.hadSignalIdQuery, dayTradingSurfaces]);

  useEffect(() => {
    if (!suggestOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = symbolComboRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [suggestOpen]);

  useEffect(() => {
    setSuggestHighlight(0);
  }, [symbolDraft, suggestOpen]);

  const updateTradingMode = (m: TradingMode) => {
    if (!dayTradingSurfaces && m === "day") return;
    // Same-mode click is a no-op — don't tear down state if the user
    // re-clicks the currently active pill (still need to fire the URL
    // / localStorage writes? No — those are already correct).
    if (m === tradingMode) return;

    // Wipe every piece of mode-bound state SYNCHRONOUSLY before the
    // mode flips. The data-fetch effects below ([symbol, tab,
    // tradingMode] for composite + [tab, tradingMode] for history)
    // re-fire on this mode change, but they only call their setters
    // AFTER the async fetch resolves. Without an eager clear here,
    // React renders the *new* mode pill alongside the *old* mode's
    // 6-layer breakdown, radar, evidence article, history rows, and
    // after-hours news — the confusing transient the user reported.
    //
    // After clearing, the 6-Layer Signal Breakdown card renders its
    // CuteLoader fallback (added in this commit), the history tab
    // shows its existing `histLoading` loader, and the after-hours
    // panel/news disappear naturally because their visibility
    // derives from `compositeResult` (now null) — the dependency
    // chain unwinds itself.
    //
    // We do NOT clear `symbol` or `symbolSnapshot` — those are
    // per-symbol, not per-mode, and the user expects to keep looking
    // at the same ticker after toggling modes.
    //
    // Layer 4 (second slice): `compositeResult` + `radarData` are
    // SWR-backed and key on (symbol, mode); the mode flip below
    // produces a fresh cache key. Because `useSignalComposite`
    // sets `keepPreviousData: false`, the hook returns
    // `composite: null` synchronously until the new mode resolves
    // — so the "clear screen between modes" UX survives without
    // the imperative setters here.
    setSignalEvidence(null);
    // If the history tab is the visible one right now, flip its
    // loader on immediately so the table area shows the loader for
    // the full transition, not "empty table → loader → new rows".
    setTradingMode(m);
    try {
      localStorage.setItem(TRADING_MODE_STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
    // Mirror the mode into the URL so deep links/refreshes stay accurate and
    // the URL remains authoritative for cross-screen handoff. We preserve
    // other query params (e.g. `symbol`) by mutating the URL in place.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("trading_mode", m);
      window.history.replaceState(null, "", url.pathname + (url.search || ""));
    } catch {
      /* ignore */
    }
  };

  // Per-symbol snapshot is now handled by `useSymbolSnapshot` above
  // (Tier 1 → Layer 4). The previous `useEffect` here did the same
  // job imperatively but without a cache — every symbol switch was
  // a fresh round trip even when the user had just looked at that
  // ticker seconds ago. SWR replaces that with stale-while-
  // revalidate semantics; no extra effect is needed here.

  const setup = useMemo(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return undefined;
    return scannerOverview.setups.find((s) => s.symbol.toUpperCase() === sym);
  }, [scannerOverview.setups, symbol]);

  const referenceLevels = useMemo(() => {
    const comp =
      compositeResult != null && !isInsufficientCompositeResponse(compositeResult)
        ? (compositeResult as Record<string, unknown>)
        : null;
    return deriveSessionReferenceLevels(snapshot, comp);
  }, [snapshot, compositeResult]);

  const rows: LayerRow[] = useMemo(() => {
    const rawLayers = compositeResult?.layers;
    const ok = compositeResult && !isInsufficientCompositeResponse(compositeResult) && Array.isArray(rawLayers);
    return layerMeta.map(([icon, name], idx) => {
      const key = SIGNAL_LAYER_KEYS[idx];
      const entry = ok
        ? (rawLayers as Array<Record<string, unknown>>).find((x) => String(x.layer ?? "").toLowerCase() === key)
        : undefined;
      const score =
        typeof entry?.score === "number" && Number.isFinite(entry.score)
          ? Math.max(0, Math.min(100, Math.round(entry.score)))
          : 0;
      const verdict = typeof entry?.verdict === "string" ? entry.verdict : "neutral";
      const st = typeof entry?.status === "string" ? entry.status : "unavailable";
      const sectorCachePending =
        key === "sector" && String(entry?.sector_resolution_state ?? "") === "pending_cache_refresh";
      const statusLabel = sectorCachePending ? "Unavailable (not factored)" : undefined;
      const baseStatus = verdictToLayerStatus(verdict, st);
      const status: LayerStatus = sectorCachePending ? "Unavailable" : baseStatus;
      const reasoning =
        typeof entry?.reasoning === "string" && entry.reasoning.trim()
          ? entry.reasoning.trim()
          : status === "Unavailable"
            ? `${name} data is unavailable right now.`
            : status === "As of close"
              ? `${name} shows the most recent close-state reading.`
            : status === "Bullish"
              ? `${name} signals align with upside continuation.`
              : status === "Bearish"
                ? `${name} signals show downside pressure.`
                : `${name} is mixed without strong direction.`;
      return {
        icon,
        name,
        status,
        statusLabel,
        sectorCachePending: sectorCachePending || undefined,
        explanation: reasoning,
        score
      };
    });
  }, [compositeResult]);

  const overall = useMemo(() => {
    if (compositeResult && !isInsufficientCompositeResponse(compositeResult) && Array.isArray(compositeResult.layers)) {
      const nums = (compositeResult.layers as Array<{ score?: unknown }>)
        .map((x) => (typeof x.score === "number" && Number.isFinite(x.score) ? x.score : null))
        .filter((x): x is number => x != null);
      if (nums.length)       return nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    const scored = rows.map((r) => r.score).filter((s): s is number => s != null);
    if (!scored.length) return 50;
    return scored.reduce((sum, s) => sum + s, 0) / scored.length;
  }, [compositeResult, rows]);

  const layerSignalSummary = useMemo(() => {
    if (compositeResult && !isInsufficientCompositeResponse(compositeResult) && typeof compositeResult.signal_summary === "string") {
      const s = String(compositeResult.signal_summary);
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    }
    return overall >= 58 ? "Bullish" : overall <= 42 ? "Bearish" : "Neutral";
  }, [compositeResult, overall]);

  /** 0–100: weighted share of layers in the dominant direction (not per-layer data confidence). */
  const layerAgreementPercent = useMemo(() => {
    if (!compositeResult || isInsufficientCompositeResponse(compositeResult)) return null;
    const ar = compositeResult.alignment_ratio;
    if (typeof ar === "number" && Number.isFinite(ar)) {
      return Math.round(Math.max(0, Math.min(1, ar)) * 100);
    }
    const ss = compositeResult.signal_strength;
    if (typeof ss === "number" && Number.isFinite(ss)) {
      return Math.round(Math.max(0, Math.min(1, ss)) * 100);
    }
    return null;
  }, [compositeResult]);

  const aiStripAgreementPct = useMemo(() => {
    if (layerAgreementPercent != null) return layerAgreementPercent;
    if (compositeResult && !isInsufficientCompositeResponse(compositeResult) && typeof compositeResult.signal_strength === "number") {
      return Math.round(Math.max(0, Math.min(1, compositeResult.signal_strength as number)) * 100);
    }
    return Math.round(overall);
  }, [layerAgreementPercent, compositeResult, overall]);

  /** Same 0–100 trade readiness as the evidence modal (API `signal_score` / strength / score map, not layer agreement). */
  const aiStripSignalScore = useMemo(() => {
    if (!compositeResult || isInsufficientCompositeResponse(compositeResult)) return null;
    const insight = parseSwingCompositeInsight(compositeResult as Record<string, unknown>);
    return insight?.signal_score ?? null;
  }, [compositeResult]);

  const setupBias = useMemo(() => normalizeSetupBias(layerSignalSummary), [layerSignalSummary]);
  const signalsPresentRows: SignalsLayerRowInput[] = useMemo(
    () =>
      rows.map((row, idx) => {
        const unavailable = row.status === "Unavailable" || row.sectorCachePending;
        const score =
          unavailable || row.score == null
            ? null
            : typeof row.score === "number" && Number.isFinite(row.score)
              ? row.score
              : null;
        return {
          key: SIGNAL_LAYER_KEYS[idx] ?? row.name.toLowerCase(),
          name: row.name,
          status: row.status,
          statusLabel: row.statusLabel,
          explanation: row.explanation,
          score,
          deltaVsBaseline: layerDeltaVsBaseline(score),
          sectorCachePending: row.sectorCachePending
        };
      }),
    [rows]
  );

  const maturationLine = useWatchlistMaturationLine(symbol, tradingMode, dayTradingSurfaces);

  const evaluationFreshness = useMemo(
    () =>
      buildSignalEvaluationFreshness({
        symbolCommitted,
        isInitialLoading: compositeInitialLoading,
        isRevalidating: compositeRevalidating,
        isMountRevalidating,
        composite:
          compositeResult != null && !isInsufficientCompositeResponse(compositeResult)
            ? (compositeResult as Record<string, unknown>)
            : null,
        isInsufficient: isInsufficientCompositeResponse(compositeResult)
      }),
    [
      symbolCommitted,
      compositeInitialLoading,
      compositeRevalidating,
      isMountRevalidating,
      compositeResult
    ]
  );

  const scenarioPlanningBundle = useMemo(() => {
    if (!symbolCommitted) return null;
    const comp =
      compositeResult != null && !isInsufficientCompositeResponse(compositeResult)
        ? (compositeResult as Record<string, unknown>)
        : null;
    return buildScenarioPlanningBundle({
      symbol,
      tradingMode,
      composite: comp,
      snapshot: snapshot ?? undefined,
      gapIntel: gapIntelSnapshot,
      setupBias,
      layerRows: signalsPresentRows,
      maturation: maturationLine
        ? {
            state: maturationLine.state,
            layers_aligned: maturationLine.layersAligned,
            layers_total: maturationLine.layersTotal,
            readiness_label: maturationLine.readinessLabel
          }
        : null,
      decisionState: null
    });
  }, [
    symbolCommitted,
    symbol,
    tradingMode,
    setupBias,
    compositeResult,
    snapshot,
    gapIntelSnapshot,
    signalsPresentRows,
    maturationLine
  ]);

  const scenarioPlanningInput = scenarioPlanningBundle?.input ?? null;

  const pageDecision = useMemo(() => {
    if (!compositeResult || isInsufficientCompositeResponse(compositeResult)) return null;
    const c = compositeResult as Record<string, unknown>;
    const rr = typeof c.risk_reward === "number" && Number.isFinite(c.risk_reward) ? c.risk_reward : 1.5;
    const rrWarning = Boolean(c.rr_warning) || isRrBelowVerdictThreshold(rr, tradingMode);
    const ar = typeof c.alignment_ratio === "number" ? c.alignment_ratio : null;
    const tfCtx =
      compositeResult && !isInsufficientCompositeResponse(compositeResult)
        ? resolveTimeframeContext(compositeResult as Record<string, unknown>, tradingMode)
        : null;
    return buildSignalsPageDecision({
      mode: tradingMode,
      bias: setupBias,
      rows: signalsPresentRows,
      signalScore: aiStripSignalScore,
      alignmentRatio: ar,
      riskReward: rr,
      rrWarning,
      isComplete: c.is_complete !== false,
      counterTrend: parseCompositeAlignment(compositeResult)?.is_counter_trend === true,
      timeframeCounterTrend: isTimeframeCounterTrend(tfCtx)
    });
  }, [compositeResult, setupBias, signalsPresentRows, aiStripSignalScore, tradingMode]);

  useEffect(() => {
    if (!deskKpiScrollTarget) return;
    let scrollId = kpiTargetScrollId(deskKpiScrollTarget);
    if (deskKpiScrollTarget === "execution" && pageDecision?.state === "actionable") {
      scrollId = SIGNALS_SECTION_TARGET.executionDetail;
    }
    const fallbackId =
      scrollId === SIGNALS_SECTION_TARGET.whyNotActionable
        ? SIGNALS_SECTION_TARGET.executionDetail
        : undefined;
    scrollToSignalsSection(scrollId, { fallbackId });
    setDeskKpiScrollTarget(null);
  }, [deskKpiScrollTarget, deskTab, pageDecision?.state]);

  const compositeAlignmentRatio = useMemo(() => {
    if (!compositeResult || isInsufficientCompositeResponse(compositeResult)) return null;
    const ar = (compositeResult as Record<string, unknown>).alignment_ratio;
    return typeof ar === "number" && Number.isFinite(ar) ? ar : null;
  }, [compositeResult]);

  const commandBarMaturationLine = useMemo(() => {
    if (!maturationLine || compositeAlignmentRatio == null) return maturationLine;
    const alignment = resolveSignalsLayerAlignment({
      rows: signalsPresentRows,
      bias: setupBias,
      alignmentRatio: compositeAlignmentRatio
    });
    const label = formatSignalsAlignmentDisplayLine(alignment, setupBias, maturationLine.state);
    return { ...maturationLine, label };
  }, [maturationLine, compositeAlignmentRatio, signalsPresentRows, setupBias]);

  const previewBlockingLayers = useMemo(
    () => pickPreviewLayers(signalsPresentRows, setupBias, 3),
    [signalsPresentRows, setupBias]
  );

  const causalNarrative = useMemo(() => {
    if (!compositeResult || isInsufficientCompositeResponse(compositeResult)) return null;
    const c = compositeResult as Record<string, unknown>;
    return resolveCausalNarrative({
      apiPayload: c.causal_narrative,
      signalSummary: layerSignalSummary,
      rows: signalsPresentRows,
      executionNote: pageDecision?.rationale?.text ?? null
    });
  }, [compositeResult, layerSignalSummary, signalsPresentRows, pageDecision?.rationale?.text]);

  const timeframeContext = useMemo(() => {
    if (!compositeResult || isInsufficientCompositeResponse(compositeResult)) return null;
    return resolveTimeframeContext(compositeResult as Record<string, unknown>, tradingMode);
  }, [compositeResult, tradingMode]);

  const profileLoaded = useUserProfileLoaded();
  const hasFundamentalAccess = useHasAIExplanations();

  const fundamentalSummary = useMemo(() => {
    if (tradingMode !== "swing") return null;
    if (!compositeResult || isInsufficientCompositeResponse(compositeResult)) return null;
    const body = compositeResult as Record<string, unknown>;
    const ctx = parseFundamentalContext(body.fundamental_context);
    const daysRaw = body.earnings_days_away;
    const earningsDays =
      typeof daysRaw === "number" && Number.isFinite(daysRaw) ? Math.round(daysRaw) : null;
    const earningsRisk = typeof body.earnings_risk === "string" ? body.earnings_risk : null;
    const newsRow = signalsPresentRows.find((r) => r.key === "news");
    return buildFundamentalBackdropSummary({
      context: ctx,
      earningsDaysAway: earningsDays,
      earningsRisk,
      newsStatus: newsRow?.status,
      setupActionable: pageDecision?.state === "actionable"
    });
  }, [tradingMode, compositeResult, signalsPresentRows, pageDecision?.state]);

  const showFundamentalUpgrade =
    tradingMode === "swing" && profileLoaded && !hasFundamentalAccess && fundamentalSummary == null;

  const scenarioReadiness = useMemo((): ScenarioReadinessContext | null => {
    if (!symbolCommitted || !scenarioPlanningBundle) return null;
    return {
      ...scenarioPlanningBundle.readiness,
      decisionState: pageDecision?.state ?? scenarioPlanningBundle.readiness.decisionState ?? null,
      systemDecision: pageDecision ?? scenarioPlanningBundle.readiness.systemDecision ?? null
    };
  }, [symbolCommitted, scenarioPlanningBundle, pageDecision]);

  const setupDirectionForEvidence =
    layerSignalSummary === "Bullish" ? "long" : layerSignalSummary === "Bearish" ? "short" : "neutral";

  const openEvidenceModal = useCallback(async () => {
    const setupLike = setup || {
      symbol: symbol.toUpperCase(),
      direction: setupDirectionForEvidence,
      score: overall / 100,
      triggers: ["Multi-layer synthesis"],
      timestamp_iso: new Date().toISOString()
    };
    let snapForEvidence: SnapshotPayload | undefined = snapshot ?? undefined;
    if (!snapshotHasTradeableLast(rawSnapshot)) {
      try {
        const row = await fetchSymbolSnapshot(symbol.toUpperCase());
        if (row && row.symbol.toUpperCase() === symbol.toUpperCase()) {
          const coerced = coerceSnapshotForReferenceLevels(row);
          if (snapshotHasTradeableLast(coerced)) {
            snapForEvidence = coerced ?? undefined;
          }
        }
      } catch {
        /* keep snapForEvidence */
      }
    }
    let symbolNewsArticles: Awaited<ReturnType<typeof fetchSymbolNews>> = [];
    try {
      symbolNewsArticles = await fetchSymbolNews(symbol.toUpperCase(), 10, {
        newsTradingMode: tradingMode
      });
    } catch {
      symbolNewsArticles = [];
    }
    const event = earningsBySymbol[symbol.toUpperCase()];
    const today = new Date().toISOString().slice(0, 10);
    const daysUntil =
      event != null
        ? Math.floor((Date.parse(`${event.report_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
        : undefined;
    setSignalEvidence(
      applySwingCompositeEnrichment(
        buildEvidenceFromSetup(setupLike, snapForEvidence, {
          symbolNewsArticles,
          earningsRiskDays: daysUntil,
          earningsReportTime: event?.report_time
        }),
        compositeResult
      )
    );
    setEvidenceOpen(true);
  }, [
    setup,
    symbol,
    setupDirectionForEvidence,
    overall,
    snapshot,
    rawSnapshot,
    tradingMode,
    earningsBySymbol,
    compositeResult
  ]);

  const scenarioPreviewPanels = useMemo(() => {
    if (!scenarioPlanningInput || !scenarioReadiness) return undefined;
    const resolved = resolveScenarioBuilderCapability(scenarioReadiness, scenarioPlanningInput);
    const comp =
      compositeResult != null && !isInsufficientCompositeResponse(compositeResult)
        ? (compositeResult as Record<string, unknown>)
        : null;
    return buildScenarioPreviewPanelData({
      symbol,
      mode: tradingMode,
      setupBias,
      composite: comp,
      layerRows: signalsPresentRows,
      alignmentRatio: compositeAlignmentRatio,
      gapIntel: gapIntelSnapshot,
      gapGate: scenarioPlanningInput.gap_intel_gate,
      executionTier: resolved.executionTier,
      surface: "signals",
      loadingLayers: compositeInitialLoading
    });
  }, [
    scenarioPlanningInput,
    scenarioReadiness,
    compositeResult,
    symbol,
    tradingMode,
    setupBias,
    signalsPresentRows,
    gapIntelSnapshot,
    compositeInitialLoading
  ]);

  const scenarioDrillDown = useMemo(
    (): ScenarioBuilderDrillDown => ({
      surface: "signals",
      onOpenEvidence: () => {
        void openEvidenceModal();
      }
    }),
    [openEvidenceModal]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!symbolCommitted) return;
    const url = new URL(window.location.href);
    const openFromQuery = url.searchParams.get("open_evidence") === "1";
    const openFromHash = url.hash === "#evidence";
    if (!openFromQuery && !openFromHash) return;
    pendingAutoEvidenceOpenRef.current = true;
    setEvidenceOpen(true);
    if (openFromHash) url.hash = "";
    if (openFromQuery) url.searchParams.delete("open_evidence");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [symbolCommitted]);

  // Layer 4 (second slice): the composite fetch + radar
  // projection used to live in a `[symbol, tab, tradingMode]`
  // useEffect that POST'd to `/api/stocvest/signals/composite/...`
  // and shoved the response through three `useState` setters
  // (`compositeResult`, `signalEvidence`, `radarData`). The
  // composite payload is now SWR-backed via `useSignalComposite`
  // (set up further up alongside `useSymbolSnapshot`); radar is
  // a pure projection of `compositeResult` so it becomes a
  // `useMemo` here, and `signalEvidence` resets via the dedicated
  // effect immediately below this block. The previous "clear
  // screen on mode flip" UX (a prior user request) survives
  // because `useSignalComposite` opts out of the
  // `keepPreviousData: true` global default — so the cache key
  // change on mode toggle yields `composite: null` synchronously
  // until the new fetch resolves.
  const radarData = useMemo<Array<{ layer: string; score: number; hist: number; scoreMissing?: boolean }> | null>(
    () => {
      if (!compositeResult || isInsufficientCompositeResponse(compositeResult)) return null;
      const raw = compositeResult.layers;
      if (!Array.isArray(raw)) return null;
      const baseline = SIGNAL_LAYER_LEVEL_BASELINE;
      return (raw as Array<Record<string, unknown>>).map((layer) => {
        const k = String(layer.layer ?? "").toLowerCase();
        const layerStatus = String(layer.status ?? "").toLowerCase();
        const sectorPending =
          k === "sector" && String(layer.sector_resolution_state ?? "") === "pending_cache_refresh";
        const n = typeof layer.score === "number" && Number.isFinite(layer.score) ? Math.round(layer.score) : null;
        const scoreMissing = layerStatus === "unavailable" && n === null;
        // Unavailable / pending sector: plot at neutral baseline — not 0 (zero reads as "no technicals").
        const score = sectorPending || scoreMissing ? baseline : n ?? baseline;
        return {
          layer: RADAR_LAYER_SHORT[k] ?? k,
          score,
          hist: baseline,
          scoreMissing: sectorPending || scoreMissing
        };
      });
    },
    [compositeResult]
  );

  // Drop cached evidence whenever composite input changes so reopening
  // (or the rebuild effect below) never shows a prior symbol/mode/payload.
  useEffect(() => {
    setSignalEvidence(null);
  }, [symbol, tradingMode, compositeResult]);

  const insufficientComposite: SwingCompositeMarketStatus | null = isInsufficientCompositeResponse(compositeResult)
    ? compositeResult.market_status
    : null;
  const hasValidSignal = compositeResult !== null && !isInsufficientCompositeResponse(compositeResult);

  useEffect(() => {
    if (!evidenceOpen || !symbolCommitted || !hasValidSignal) return;
    if (pendingAutoEvidenceOpenRef.current) {
      pendingAutoEvidenceOpenRef.current = false;
      void openEvidenceModal();
      return;
    }
    if (!signalEvidence) {
      void openEvidenceModal();
    }
  }, [evidenceOpen, symbolCommitted, hasValidSignal, compositeResult, signalEvidence, openEvidenceModal]);

  const evidenceModalLoading = evidenceOpen && !signalEvidence;

  const compositeServiceMessage: ReactNode =
    compositeFetchErrorMessage || compositeTransportError?.message ? (
      <div
        data-testid="signals-composite-service-error"
        style={{
          background: "rgba(239,68,68,0.06)",
          border: "1px solid rgba(239,68,68,0.22)",
          borderRadius: 12,
          padding: 24
        }}
      >
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#ef4444" }}>
          Signal service unavailable
        </p>
        <p style={{ margin: `${spacing[2]} 0 0 0`, fontSize: 13, lineHeight: 1.55, color: colors.textMuted }}>
          {compositeFetchErrorMessage ?? compositeTransportError?.message}
        </p>
      </div>
    ) : null;

  const insufficientLayerMessage: ReactNode = insufficientComposite ? (
    <div
      style={{
        background: "rgba(245,197,66,0.06)",
        border: "1px solid rgba(245,197,66,0.2)",
        borderRadius: 12,
        padding: 24
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: spacing[3] }}>
        <Clock size={22} color="#f5c542" strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#f5c542" }}>Market Data Unavailable</p>
          <p style={{ margin: `${spacing[2]} 0 0 0`, fontSize: 13, lineHeight: 1.55, color: colors.textMuted }}>
            Real-time data is needed to generate a reliable signal. At least 3 of 6 layers must have live data.
          </p>
          {insufficientComposite.market_session === "closed" ? (
            <p style={{ margin: `${spacing[2]} 0 0 0`, fontSize: 13, lineHeight: 1.55, color: colors.textMuted }}>
              Market is closed right now.
              {insufficientComposite.next_open ? ` Next session: ${insufficientComposite.next_open}.` : null}
            </p>
          ) : null}
          {insufficientComposite.market_session === "pre_market" ||
          insufficientComposite.market_session === "after_hours" ? (
            <p style={{ margin: `${spacing[2]} 0 0 0`, fontSize: 13, lineHeight: 1.55, color: colors.textMuted }}>
              {insufficientComposite.market_session === "pre_market"
                ? "Pre-market data is limited."
                : "After-hours data is limited."}{" "}
              Full signals are available at market open 9:30 AM ET.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  useEffect(() => {
    if (!symbol.trim() || compositeResult === null) return;
    try {
      sessionStorage.setItem(SIGNALS_SESSION_SYMBOL_KEY, symbol.trim().toUpperCase());
    } catch {
      /* ignore */
    }
  }, [compositeResult, symbol]);

  const showAfterHoursPanel =
    tradingMode === "day" && insufficientComposite?.market_session === "closed";

  // Layer 4 (second slice): after-hours news is now SWR-cached
  // via `useSymbolNews`. The hook is `enabled` only when the
  // panel is visible — i.e. day-mode + market closed — so we
  // don't speculatively fetch news that the user can't see.
  // Watchlist membership stays in its own `useEffect` because
  // it's not symbol-mode-keyed (the user's default watchlist is
  // a global resource) and SWR'ing it would buy nothing here.
  const { articles: afterHoursNews } = useSymbolNews(symbol, {
    limit: 5,
    mode: tradingMode,
    enabled: showAfterHoursPanel
  });

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym || !showAfterHoursPanel) {
      setAfterHoursInWatchlist(false);
      setAfterHoursWatchlistKnown(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stocvest/watchlists/default/symbols", {
          method: "GET"
        });
        if (cancelled) return;
        let watchlistSymbols: string[] = [];
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as { symbols?: string[] };
          if (Array.isArray(data.symbols)) {
            watchlistSymbols = data.symbols
              .map((row) => String(row).trim().toUpperCase())
              .filter(Boolean);
          }
        }
        if (cancelled) return;
        setAfterHoursInWatchlist(watchlistSymbols.includes(sym));
        setAfterHoursWatchlistKnown(true);
      } catch {
        if (cancelled) return;
        setAfterHoursInWatchlist(false);
        setAfterHoursWatchlistKnown(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAfterHoursPanel, symbol]);

  const deskKpiItems = useMemo(() => {
    if (!pageDecision) return [];
    return buildSignalsDeskKpiItems({
      bias: setupBias,
      rows: signalsPresentRows,
      decision: pageDecision,
      tradingMode,
      alignmentRatio: compositeAlignmentRatio,
      maturationState: maturationLine?.state
    });
  }, [
    pageDecision,
    setupBias,
    signalsPresentRows,
    tradingMode,
    compositeAlignmentRatio,
    maturationLine?.state
  ]);

  /**
   * Build the page-context payload published to the STOCVEST Assistant chatbot.
   *
   * The chatbot's locked system prompt lives on the server; this hook only forwards what
   * is visible on screen so the assistant can ground its explanations in the same data
   * the user is looking at. `synthTradeDecision` is the single source of truth for the
   * Decision state and rationale — the Evidence card reads it for display, this hook
   * reads it for chatbot context. No internal weights or thresholds are exposed.
   */
  const assistantContext = useMemo<AssistantPageContext | null>(() => {
    const pageId = "signals/layers";
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      return { page: pageId, trading_mode: tradingMode };
    }
    /**
     * Always derive the partial layer status from `signalEvidence.layers` if it exists, even
     * when `insight` is missing. The assistant uses this to ground its answer in what the
     * page can show, not just the symbol. When neither is loaded, mark analysis_status so
     * the assistant explains STOCVEST in general terms instead of describing its own access.
     */
    const layerStatus: Partial<Record<AssistantLayerKey, AssistantLayerStatus>> = {};
    for (const layer of signalEvidence?.layers ?? []) {
      const k = layer.key as AssistantLayerKey;
      if (
        k === "technical" ||
        k === "news" ||
        k === "macro" ||
        k === "sector" ||
        k === "geopolitical" ||
        k === "internals"
      ) {
        layerStatus[k] = layer.status;
      }
    }
    const layerStatusForCtx = Object.keys(layerStatus).length > 0 ? layerStatus : undefined;

    const gapIntelForAssistant = sym ? narrowGapIntelForAssistant(gapIntelSnapshot) : undefined;

    if (!signalEvidence || !signalEvidence.insight) {
      return {
        page: pageId,
        trading_mode: tradingMode,
        symbol: sym || undefined,
        analysis_status: sym ? "loading" : undefined,
        layer_status: layerStatusForCtx,
        ...(gapIntelForAssistant ? { gap_intel: gapIntelForAssistant } : {})
      };
    }
    const insight = signalEvidence.insight;
    const decision = synthTradeDecision(signalEvidence, insight, tradingMode);
    return {
      page: pageId,
      trading_mode: tradingMode,
      symbol: sym,
      analysis_status: "loaded",
      decision_state: decision.state,
      decision_line: decision.line,
      decision_rationale: decision.rationale ?? undefined,
      conviction_tier: decision.conviction?.tier,
      conviction_label: decision.conviction?.label,
      conviction_summary: decision.conviction?.summaryLine,
      trade_readiness:
        typeof insight.signal_score === "number" && Number.isFinite(insight.signal_score)
          ? insight.signal_score
          : null,
      risk_reward:
        typeof insight.risk_reward === "number" && Number.isFinite(insight.risk_reward)
          ? insight.risk_reward
          : null,
      trend_strength: insight.trend_strength || undefined,
      trend_direction: insight.trend_direction || undefined,
      market_regime: insight.market_regime || undefined,
      causal_narrative_summary: causalNarrative?.summary,
      causal_blocking_chain: causalNarrative?.chainLabel || undefined,
      timeframe_alignment_label: timeframeContext?.alignment.label,
      layer_alignment_pct:
        insight.alignment_ratio != null && Number.isFinite(insight.alignment_ratio)
          ? Math.round(Math.max(0, Math.min(1, insight.alignment_ratio)) * 100)
          : null,
      layer_status: layerStatusForCtx,
      ...(gapIntelForAssistant ? { gap_intel: gapIntelForAssistant } : {})
    };
  }, [tradingMode, symbol, signalEvidence, gapIntelSnapshot, causalNarrative, timeframeContext]);

  usePublishAssistantContext(assistantContext);


  return (
    <section className="signals-page-root min-w-0" style={{ display: "grid", gap: spacing[4] }}>
      <div
        ref={symbolComboRef}
        className={`relative w-full min-w-0 sm:max-w-xl${suggestOpen ? " z-50" : ""}`}
      >
        <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="signal-symbol" className="text-sm sm:shrink-0" style={{ color: colors.textMuted }}>
            Symbol
          </label>
          <input
            id="signal-symbol"
            role="combobox"
            aria-expanded={suggestOpen}
            aria-controls="signal-symbol-suggestions"
            aria-autocomplete="list"
            value={symbolDraft}
            autoComplete="off"
            onChange={(e) => {
              const v = e.target.value;
              setSymbolDraft(v);
              setSuggestOpen(true);
              if (unverifiedSymbolNote) setUnverifiedSymbolNote(null);
              if (!v.trim()) {
                applyCommittedSymbol("");
              }
            }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => {
              window.setTimeout(() => {
                const raw = symbolDraft.trim();
                if (!raw) {
                  applyCommittedSymbol("");
                  return;
                }
                const t = parseTickerInput(raw);
                if (!t) return;
                if (tickersEquivalent(t, symbol)) return;
                if (canCommitTicker(raw)) {
                  applyCommittedSymbol(t);
                } else {
                  setUnverifiedSymbolNote(buildUnverifiedSymbolNote(t));
                }
              }, 120);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSuggestOpen(false);
                return;
              }
              if (e.key === "ArrowDown" && suggestionRows.length) {
                e.preventDefault();
                setSuggestOpen(true);
                setSuggestHighlight((i) => Math.min(i + 1, suggestionRows.length - 1));
                return;
              }
              if (e.key === "ArrowUp" && suggestionRows.length) {
                e.preventDefault();
                setSuggestHighlight((i) => Math.max(i - 1, 0));
                return;
              }
              if (e.key === "Enter") {
                const pick = suggestionRows[suggestHighlight];
                if (pick) {
                  e.preventDefault();
                  applyCommittedSymbol(pick.symbol);
                  return;
                }
                const t = parseTickerInput(symbolDraft);
                if (!t) return;
                e.preventDefault();
                if (canCommitTicker(symbolDraft)) {
                  applyCommittedSymbol(t);
                } else {
                  setUnverifiedSymbolNote(buildUnverifiedSymbolNote(t));
                }
              }
            }}
            placeholder="Ticker or company name"
            className="min-h-11 w-full min-w-0 text-base sm:flex-1"
            style={{
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.text,
              padding: `${spacing[2]} ${spacing[3]}`
            }}
          />
        </div>
        {suggestOpen &&
        (suggestionRows.length > 0 ||
          (remoteSearchLoading && isTickerSearchQueryReady(symbolDraft)) ||
          (Boolean(remoteSearchError) && isTickerSearchQueryReady(symbolDraft))) ? (
          <ul
            id="signal-symbol-suggestions"
            role="listbox"
            className="absolute left-0 right-0 top-full z-[1] mt-1 max-h-60 overflow-y-auto rounded-md border py-1 shadow-lg sm:left-auto sm:right-auto sm:min-w-full"
            style={{
              borderColor: colors.border,
              background: colors.surface,
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)"
            }}
          >
            {remoteSearchError && isTickerSearchQueryReady(symbolDraft) ? (
              <li className="px-3 py-2 text-sm leading-snug" style={{ color: colors.bearish }}>
                {remoteSearchError}
              </li>
            ) : null}
            {remoteSearchLoading && suggestionRows.length === 0 && isTickerSearchQueryReady(symbolDraft) && !remoteSearchError ? (
              <li className="px-3 py-2 text-sm" style={{ color: colors.textMuted }}>
                Searching…
              </li>
            ) : null}
            {suggestionRows.map((row, idx) => (
              <li key={row.symbol} role="option" aria-selected={idx === suggestHighlight}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm"
                  style={{
                    background: idx === suggestHighlight ? "rgba(59,130,246,0.15)" : "transparent",
                    color: colors.text,
                    border: "none",
                    cursor: "pointer"
                  }}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => applyCommittedSymbol(row.symbol)}
                >
                  <span className="font-semibold tracking-wide">{row.symbol}</span>
                  {row.label !== row.symbol ? (
                    <span className="block text-xs" style={{ color: colors.textMuted }}>
                      {row.label.includes("—") ? row.label.split("—").slice(1).join("—").trim() : row.label}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            {!remoteSearchLoading &&
            !remoteSearchError &&
            suggestionRows.length === 0 &&
            isTickerSearchQueryReady(symbolDraft) ? (
              <li className="px-3 py-2 text-sm" style={{ color: colors.textMuted }}>
                No matching tickers. Try a symbol (e.g. AAPL) or another spelling.
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      {unverifiedSymbolNote ? (
        <p
          role="status"
          aria-live="polite"
          style={{
            margin: `${spacing[1]} 0 0`,
            color: colors.textMuted,
            fontSize: typography.scale.xs,
            lineHeight: 1.6
          }}
        >
          {unverifiedSymbolNote}
        </p>
      ) : null}

      {!symbolCommitted ? (
        <article
          className={surfaceGlowClassName}
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.xl,
            padding: spacing[4],
            maxWidth: 560
          }}
        >
          <h2 style={{ margin: `0 0 ${spacing[2]}`, fontSize: typography.scale.lg, color: colors.text }}>Analyze a symbol</h2>
          <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.6, fontSize: typography.scale.sm }}>
            Enter a ticker to view STOCVEST&apos;s six-layer signal analysis and trade readiness.
          </p>
          <p style={{ margin: `${spacing[3]} 0 0`, color: colors.textMuted, lineHeight: 1.6, fontSize: typography.scale.sm }}>
            This page evaluates symbols you choose — it does not recommend trades.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-md px-4 text-sm font-medium"
              style={{ border: `1px solid ${colors.border}`, background: colors.surfaceMuted, color: colors.text }}
              onClick={() => void openWatchlistPicker()}
            >
              Select from Watchlist
            </button>
            <Link
              href="/dashboard/scanner"
              className="inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium no-underline"
              style={{ border: `1px solid ${colors.border}`, background: colors.surfaceMuted, color: colors.accent }}
            >
              Open Scanner
            </Link>
          </div>
        </article>
      ) : null}

      <SignalsWatchlistPickerModal
        open={watchlistPickerOpen}
        symbols={watchlistPickerSyms}
        maturationBySymbol={watchlistPickerMaturation}
        loading={watchlistPickerLoading}
        tradingMode={tradingMode}
        onSelect={(s) => {
          applyCommittedSymbol(s);
          setWatchlistPickerOpen(false);
        }}
        onClose={() => setWatchlistPickerOpen(false)}
      />

      {symbolCommitted ? (
        <>
      <header
        className="signals-sticky-command sticky z-20 -mx-4 mb-1 w-full max-w-none self-start px-4 pb-2 pt-0 lg:-mx-6 lg:px-6"
        style={{
          top: APP_TOP_BAR_LAYOUT_HEIGHT,
          background: colors.background,
          borderBottom: `1px solid ${colors.border}`
        }}
        data-testid="signals-sticky-command"
      >
        <SignalsCommandBar
          symbol={symbol}
          tradingMode={tradingMode}
          dayTradingSurfaces={dayTradingSurfaces}
          watchlistControl={<AddToWatchlistButton symbol={symbol} dualDeskTracking={dayTradingSurfaces} />}
          scenarioControl={
            scenarioPlanningInput ? (
              <ScenarioBuilderInline
                input={scenarioPlanningInput}
                readiness={scenarioReadiness}
                drillDown={scenarioDrillDown}
                previewPanels={scenarioPreviewPanels}
                prominent
                testId="signals-scenario-inline"
              />
            ) : null
          }
          maturationLine={commandBarMaturationLine}
          evaluationFreshness={evaluationFreshness}
          resumedFromSession={resumedFromSession}
          onTradingModeChange={updateTradingMode}
          onOpenEvidence={hasValidSignal ? () => void openEvidenceModal() : undefined}
          priceContext={deskPriceContext}
        />
        {hasValidSignal && pageDecision && deskKpiItems.length > 0 ? (
          <SignalsDeskKpiStrip
            items={deskKpiItems}
            activeTab={deskTab}
            onSelectTarget={applyDeskKpiTarget}
          />
        ) : null}
        {hasValidSignal && pageDecision ? (
          <SignalsExecutionContextStrip decision={pageDecision} tradingMode={tradingMode} />
        ) : null}
      </header>

      {symbolCommitted ? (
        <div className="mb-2 min-w-0" data-testid="signals-desk-tab-nav-wrap">
          <SignalsDeskTabNav activeTab={deskTab} onTabChange={applyDeskTab} />
        </div>
      ) : null}

      <div className="signals-page-flow min-w-0">
        {symbolCommitted && deskTab === "setup" ? (
          <div
            id={SIGNALS_SECTION_TARGET.setup}
            className="flex min-w-0 flex-col gap-4"
            data-testid="signals-tab-panel-setup"
            role="tabpanel"
          >
            {compositeResult === null ? (
              <div style={{ padding: `${spacing[6]} ${spacing[2]}` }} data-testid="signals-setup-loading">
                <CuteLoader
                  label={`Loading ${tradingMode === "swing" ? "swing" : "day"} signal`}
                  sublabel={`Refreshing setup for ${symbol.trim().toUpperCase()}.`}
                  compact
                />
              </div>
            ) : null}
            {hasValidSignal && pageDecision ? (
              <SignalsFormingBanner
                decisionState={pageDecision.state}
                maturationLabel={commandBarMaturationLine?.label ?? null}
              />
            ) : null}
            {hasValidSignal ? (
              <SignalsBiasRationalePanel
                bias={setupBias}
                rows={signalsPresentRows}
                signalSummary={layerSignalSummary}
              />
            ) : null}
            {hasValidSignal ? (
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
                {pageDecision ? (
                  <SignalsWhyNotPanel
                    decision={pageDecision}
                    previewLayers={previewBlockingLayers}
                    bias={setupBias}
                    allLayers={signalsPresentRows}
                    signalSummary={layerSignalSummary}
                    causalNarrativeOnPage={
                      Boolean(causalNarrative && pageDecision?.state !== "actionable")
                    }
                    causalNarrativeApi={
                      compositeResult && !isInsufficientCompositeResponse(compositeResult)
                        ? (compositeResult as Record<string, unknown>).causal_narrative
                        : undefined
                    }
                  />
                ) : null}
                <SignalsReferenceLevels
                  levels={referenceLevels}
                  setupPattern={setup?.triggers[0] ?? null}
                />
              </div>
            ) : insufficientLayerMessage ? (
              <div data-testid="signals-setup-insufficient">{insufficientLayerMessage}</div>
            ) : compositeServiceMessage ? (
              <div data-testid="signals-setup-service-error">{compositeServiceMessage}</div>
            ) : null}
            {hasValidSignal && timeframeContext ? (
              <TimeframeContextPanel context={timeframeContext} tradingMode={tradingMode} compact />
            ) : null}
            {hasValidSignal && causalNarrative && pageDecision?.state !== "actionable" ? (
              <CausalNarrativePanel narrative={causalNarrative} compact />
            ) : null}
            {hasValidSignal && pageDecision ? (
              <SignalsSetupRead
                symbol={symbol}
                tradingMode={tradingMode}
                bias={setupBias}
                rows={signalsPresentRows}
                decision={pageDecision}
                previewLayers={previewBlockingLayers}
                maturationState={maturationLine?.state}
                alignmentRatio={compositeAlignmentRatio}
                fundamentalSummary={fundamentalSummary}
                showFundamentalUpgrade={showFundamentalUpgrade}
                layout="desk"
              />
            ) : null}
            {showAfterHoursPanel ? (
              <div id={SIGNALS_SECTION_TARGET.context}>
                <SignalsAfterHoursPanel
                  symbol={symbol}
                  snapshot={snapshot}
                  marketStatus={insufficientComposite}
                  earningsEvent={earningsBySymbol[symbol.toUpperCase()] ?? null}
                  newsArticles={afterHoursNews}
                  isInDefaultWatchlist={afterHoursInWatchlist}
                  watchlistCheckComplete={afterHoursWatchlistKnown}
                  dualDeskTracking={dayTradingSurfaces}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {symbolCommitted && deskTab === "layers" ? (
          <div
            id={SIGNALS_SECTION_TARGET.layers}
            className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.35fr_1fr] [&>*]:min-w-0"
            data-testid="signals-tab-panel-layers"
            role="tabpanel"
          >
            <SignalsLayerBreakdown
              symbol={symbol}
              tradingMode={tradingMode}
              bias={setupBias}
              rows={signalsPresentRows}
              loading={compositeResult === null}
              insufficient={Boolean(insufficientComposite) || Boolean(compositeServiceMessage)}
              insufficientMessage={compositeServiceMessage ?? insufficientLayerMessage}
              maturationState={maturationLine?.state}
              alignmentRatio={compositeAlignmentRatio}
              defaultExpanded
              causalNarrative={causalNarrative}
            />
            {radarData ? <SignalsRadarPanel data={radarData} isMobileLayout={isMobileLayout} /> : null}
          </div>
        ) : null}

        {symbolCommitted && deskTab === "evolution" ? (
          <div
            id={SIGNALS_SECTION_TARGET.evolution}
            className="scroll-mt-4"
            data-testid="signals-tab-panel-evolution"
            role="tabpanel"
            ref={evolutionPanelRef}
          >
            <SetupEvolutionPanel symbol={symbol} tradingMode={tradingMode} />
          </div>
        ) : null}
      </div>
        </>
      ) : null}
      <SignalEvidenceModal
        open={evidenceOpen}
        evidence={signalEvidence}
        loading={evidenceModalLoading}
        loadingSymbol={symbol.trim() ? symbol : null}
        onClose={() => {
          pendingAutoEvidenceOpenRef.current = false;
          setEvidenceOpen(false);
        }}
        gapIntelSnapshot={gapIntelSnapshot}
        onOpenNewsPanel={(sym) => {
          setNewsPanelSymbol(sym.trim().toUpperCase());
          setNewsPanelOpen(true);
        }}
      />
      <NewsPanel
        symbol={newsPanelSymbol}
        isOpen={newsPanelOpen}
        newsTradingMode={tradingMode}
        onClose={() => {
          setNewsPanelOpen(false);
          setNewsUiTick((t) => t + 1);
        }}
        onLoaded={() => setNewsUiTick((t) => t + 1)}
      />
    </section>
  );
}


