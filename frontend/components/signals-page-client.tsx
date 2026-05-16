"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Clock } from "lucide-react";
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from "recharts";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { useSignalComposite } from "@/lib/hooks/use-signal-composite";
import { useGapIntel } from "@/lib/hooks/use-gap-intel";
import { useSymbolNews } from "@/lib/hooks/use-symbol-news";
import { useSymbolSnapshot } from "@/lib/hooks/use-symbol-snapshot";
import type { MarketOverview, NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { SignalsCommandBar } from "@/components/signals/signals-command-bar";
import { SignalsLayerBreakdown } from "@/components/signals/signals-layer-breakdown";
import { SignalsWatchlistPickerModal } from "@/components/signals/signals-watchlist-picker-modal";
import type { WatchlistMaturationRow } from "@/lib/watchlist-page-utils";
import { normalizeWatchlistMaturationBySymbol } from "@/lib/watchlist-page-utils";
import { SignalsReferenceLevels } from "@/components/signals/signals-reference-levels";
import { SignalsSetupRead } from "@/components/signals/signals-setup-read";
import { useWatchlistMaturationLine } from "@/lib/hooks/use-watchlist-maturation-line";
import {
  buildSignalsPageDecision,
  normalizeSetupBias,
  pickPreviewLayers,
  type SignalsLayerRowInput
} from "@/lib/signals-page-present";
import { CuteLoader } from "@/components/cute-loader";
import { SignalLayerDivergenceChart } from "@/components/signal-layer-divergence-chart";
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
  parseSwingCompositeInsight,
  type SignalEvidenceData
} from "@/lib/signal-evidence";
import {
  fetchLiveSignals,
  fetchUserEvaluatedSignals,
  formatHorizonOutcome,
  type PublicSignal
} from "@/lib/api/public-signals";
import { rankSymbolCandidates } from "@/lib/symbol-suggestion-rank";
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
  earningsBySymbol: Record<string, EarningsEvent>;
  signalsPrefill?: SignalsPagePrefill;
  /** Swing Pro hides intraday engine UI; server coerces deep-links the same way. */
  dayTradingSurfaces?: boolean;
}

const SIGNALS_SESSION_SYMBOL_KEY = "stocvest_signals_session_symbol";

type SymbolCandidate = { symbol: string; label: string };

function normalizeTickerInput(raw: string): string | null {
  const u = raw.trim().toUpperCase();
  if (!u) return null;
  if (/^[A-Z]{1,6}$/.test(u)) return u;
  if (/^[A-Z]{1,5}\.[A-Z]$/.test(u)) return u;
  return null;
}

/** Polygon reference search / manual entry — slightly wider than strict 6-letter US symbols. */
function normalizeTickerFromApi(raw: string): string | null {
  const u = raw.trim().toUpperCase();
  if (!u) return null;
  const narrow = normalizeTickerInput(u);
  if (narrow) return narrow;
  if (/^[A-Z]{1,10}$/.test(u)) return u;
  if (/^[A-Z0-9]{1,8}\.[A-Z]{1,3}$/.test(u)) return u;
  return null;
}

/**
 * Bucket a 0–100 layer-alignment score into "High / Moderate / Low" for the past-signals table.
 *
 * Avoids exposing raw percentages to users: that wording was reading as confidence/probability,
 * which the radar score is not. "Moderate" is preferred over "Medium" per the Signal State
 * History spec — it reads as a careful assessment rather than a graded score.
 */
function formatLayerAlignmentBucket(score: number | null | undefined): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "—";
  if (score >= 70) return "High";
  if (score >= 40) return "Moderate";
  return "Low";
}

/**
 * Tooltip wording for the Signal State History table — kept in one place so the philosophy
 * of "describe price behavior, do not judge the signal" stays consistent across every column,
 * filter, and header. See product spec: "This table describes what happened after STOCVEST
 * spoke — not whether it should have been traded."
 */
const SIGNAL_STATE_HISTORY_TOOLTIPS = {
  table:
    "STOCVEST separates signal states from trade permission. Many signals shown here were not actionable due to risk, regime, or confirmation gates.",
  filterSignalBias: "Filter by the directional bias STOCVEST expressed.",
  filterPriceReaction:
    "Filter by how price moved after the signal state. This does not imply correctness or tradability.",
  colTime: "Timestamp when STOCVEST issued the signal state.",
  colSymbol: "Ticker symbol evaluated by STOCVEST.",
  colSignalBias:
    "Directional bias expressed by STOCVEST at the time, based on multi-layer analysis.",
  colAlignment:
    "Degree of agreement across STOCVEST's six analysis layers at the time the signal state was issued.",
  colPattern: "Technical pattern context at the time of the signal, if available.",
  colPriceAtSignal: "Last traded price when the signal state was issued.",
  col1hReaction:
    "Observed price movement over the first hour after the signal state was issued. This reflects price behavior only, not signal correctness.",
  col1dReaction:
    "Observed price movement over the next trading day after the signal state was issued. This does not represent trade performance or profitability."
} as const;

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

/** Persist the experienced-user choice to keep the radar open across visits; default stays collapsed. */
const SIGNAL_RADAR_EXPANDED_STORAGE_KEY = "stocvest_signal_radar_expanded";

const RADAR_LAYER_LABEL: Record<string, string> = {
  technical: "Technical",
  news: "News",
  macro: "Macro",
  sector: "Sector",
  geopolitical: "Geopolitical",
  internals: "Internals"
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
  earningsBySymbol,
  signalsPrefill = {
    urlSymbol: null,
    signalIdForResolve: null,
    hadSignalIdQuery: false,
    initialTradingMode: null
  },
  dayTradingSurfaces = true
}: SignalsPageClientProps) {
  const { colors, theme } = useTheme();
  const historyFilterSelectStyle: CSSProperties = {
    borderRadius: borderRadius.md,
    border: `1px solid ${colors.border}`,
    padding: spacing[2],
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    colorScheme: theme === "dark" ? "dark" : "light"
  };
  const historyFilterOptionStyle: CSSProperties = {
    backgroundColor: colors.surfaceMuted,
    color: colors.text
  };
  const isMobileLayout = useIsMobileLayout();
  const symbolComboRef = useRef<HTMLDivElement | null>(null);
  /** Click-outside container for the "Past signal states" symbol typeahead (mirrors layer-analysis combobox). */
  const histSymbolComboRef = useRef<HTMLDivElement | null>(null);
  const signalIdUrlStrippedRef = useRef(false);
  const [tab, setTab] = useState<"layers" | "history">("layers");
  const [tradingMode, setTradingMode] = useState<TradingMode>(() => {
    const raw = signalsPrefill.initialTradingMode;
    const base: TradingMode = raw === "day" || raw === "swing" ? raw : "swing";
    return dayTradingSurfaces ? base : "swing";
  });
  const [symbol, setSymbol] = useState(() => signalsPrefill.urlSymbol ?? "");
  const [symbolDraft, setSymbolDraft] = useState(() => signalsPrefill.urlSymbol ?? "");
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
  /** Radar is detail-dense; collapsed by default so narrative layers stay primary. */
  const [signalRadarExpanded, setSignalRadarExpanded] = useState(false);
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
  const [historyRows, setHistoryRows] = useState<PublicSignal[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  /** Committed symbol used to filter the past-signals table; "" means no filter. */
  const [histSymbolFilter, setHistSymbolFilter] = useState("");
  /** Free-text input for history symbol typeahead (accepts ticker or company name). */
  const [histSymbolDraft, setHistSymbolDraft] = useState("");
  const [histSuggestOpen, setHistSuggestOpen] = useState(false);
  const [histSuggestHighlight, setHistSuggestHighlight] = useState(0);
  const [histRemoteCandidates, setHistRemoteCandidates] = useState<SymbolCandidate[]>([]);
  const [histRemoteSearchLoading, setHistRemoteSearchLoading] = useState(false);
  const [histRemoteSearchError, setHistRemoteSearchError] = useState<string | null>(null);
  const [histDirectionFilter, setHistDirectionFilter] = useState<"all" | "bullish" | "bearish" | "neutral">("all");
  const [histOutcomeFilter, setHistOutcomeFilter] = useState<
    "all" | "correct" | "incorrect" | "neutral" | "pending"
  >("all");
  const [historySource, setHistorySource] = useState<"user" | "public">("public");
  // Layer 4 (second slice): per-symbol composite is now SWR-cached.
  // The hook re-fetches when (symbol, mode) changes; the Layers /
  // History tab toggle gates via `enabled` so the History tab
  // never fires a composite call. `keepPreviousData: false`
  // overrides the global default so the screen-clear UX on
  // mode-pill toggle (a previous user request) survives the cache
  // layer — the new mode's pill never renders alongside the
  // previous mode's 6-layer breakdown / radar / evidence.
  const { composite: compositeResult } = useSignalComposite(symbol, tradingMode, {
    enabled: tab === "layers"
  });
  const [afterHoursInWatchlist, setAfterHoursInWatchlist] = useState(false);
  const [afterHoursWatchlistKnown, setAfterHoursWatchlistKnown] = useState(false);

  const symbolCommitted = symbol.trim().length > 0;

  const { snapshot: gapIntelSnapshot } = useGapIntel(symbol, tradingMode, {
    enabled: tab === "layers" && symbolCommitted
  });
  const symbolCandidates = useMemo(() => {
    const m = new Map<string, SymbolCandidate>();
    const add = (sym: string, name?: string | null) => {
      const u = normalizeTickerInput(sym);
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
    return Array.from(m.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [scannerOverview.setups, scannerOverview.gapIntelligence, marketOverview.snapshots]);

  useEffect(() => {
    const q = symbolDraft.trim();
    if (q.length < 2) {
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
            const sym = normalizeTickerFromApi(String(o.symbol ?? ""));
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
    return rankSymbolCandidates(merged, q).slice(0, 12);
  }, [symbolCandidates, symbolDraft, remoteCandidates]);

  const applyCommittedSymbol = useCallback((sym: string | null | undefined) => {
    const t = normalizeTickerFromApi(String(sym ?? ""));
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
              .map((x) => normalizeTickerInput(String(x)))
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
                .map((x) => normalizeTickerInput(String(x)))
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
      const u = sym.toUpperCase();
      if (!u) return false;
      if (symbolCandidates.some((c) => c.symbol === u)) return true;
      if (remoteCandidates.some((c) => c.symbol === u)) return true;
      if (userWatchlistSyms.includes(u)) return true;
      return false;
    },
    [symbolCandidates, remoteCandidates, userWatchlistSyms]
  );

  /** Calm one-line caption used under the symbol input — kept in code so wording lives in one place. */
  const buildUnverifiedSymbolNote = useCallback(
    (sym: string): string =>
      `No session data found for "${sym}". Verify the ticker or choose from the suggestions above.`,
    []
  );

  /**
   * Past-signals symbol filter typeahead — mirrors the layer-analysis combobox so users
   * can search by ticker or company name. Reuses the local `symbolCandidates` map and
   * adds an independent debounced remote search so the two inputs don't fight.
   */
  useEffect(() => {
    const q = histSymbolDraft.trim();
    if (q.length < 2) {
      setHistRemoteCandidates([]);
      setHistRemoteSearchLoading(false);
      setHistRemoteSearchError(null);
      return;
    }
    let cancelled = false;
    setHistRemoteSearchLoading(true);
    setHistRemoteSearchError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/stocvest/market/tickers-search?q=${encodeURIComponent(q)}`, {
            credentials: "same-origin",
            cache: "no-store"
          });
          if (cancelled) return;
          if (!res.ok) {
            setHistRemoteSearchError(`Search failed (${res.status}). Try a known symbol.`);
            setHistRemoteCandidates([]);
            return;
          }
          const j = (await res.json().catch(() => ({}))) as { items?: unknown; error?: unknown };
          const items = Array.isArray(j.items) ? j.items : [];
          const next: SymbolCandidate[] = [];
          for (const it of items) {
            if (!it || typeof it !== "object") continue;
            const o = it as { symbol?: unknown; name?: unknown };
            const sym = normalizeTickerFromApi(String(o.symbol ?? ""));
            if (!sym) continue;
            const name = String(o.name ?? "").trim();
            next.push({ symbol: sym, label: name ? `${sym} — ${name}` : sym });
          }
          const bodyError = typeof j.error === "string" ? j.error.trim() : "";
          if (!cancelled) {
            setHistRemoteCandidates(next);
            setHistRemoteSearchError(next.length === 0 && bodyError ? bodyError : null);
          }
        } catch {
          if (!cancelled) {
            setHistRemoteCandidates([]);
            setHistRemoteSearchError("Network error while searching tickers.");
          }
        } finally {
          if (!cancelled) setHistRemoteSearchLoading(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setHistRemoteSearchLoading(false);
    };
  }, [histSymbolDraft]);

  const histSuggestionRows = useMemo(() => {
    const q = histSymbolDraft.trim();
    if (!q) return symbolCandidates.slice(0, 8);
    // Same ticker-first ranking as the committed-symbol typeahead.
    // The two dropdowns share a candidate pool and share the same
    // user mental model ("show me the ticker first") so they must
    // share the same ordering function.
    const seen = new Set<string>();
    const merged: SymbolCandidate[] = [];
    for (const c of [...symbolCandidates, ...histRemoteCandidates]) {
      const sym = c.symbol.toUpperCase();
      if (seen.has(sym)) continue;
      seen.add(sym);
      merged.push(c);
    }
    return rankSymbolCandidates(merged, q).slice(0, 12);
  }, [symbolCandidates, histSymbolDraft, histRemoteCandidates]);

  /** Commit a typeahead choice (or empty string) to the past-signals symbol filter. */
  const applyHistSymbol = useCallback((sym: string | null | undefined) => {
    const t = normalizeTickerFromApi(String(sym ?? ""));
    if (!t) {
      setHistSymbolFilter("");
      setHistSymbolDraft("");
      setHistSuggestOpen(false);
      return;
    }
    setHistSymbolFilter(t);
    setHistSymbolDraft(t);
    setHistSuggestOpen(false);
  }, []);

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
        ? data.symbols.map((x) => String(x)).map((x) => normalizeTickerInput(x)).filter((x): x is string => Boolean(x))
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
      const raw = localStorage.getItem(SIGNAL_RADAR_EXPANDED_STORAGE_KEY);
      if (raw === "1") setSignalRadarExpanded(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (signalsPrefill.urlSymbol || signalsPrefill.signalIdForResolve) return;
    try {
      const s = sessionStorage.getItem(SIGNALS_SESSION_SYMBOL_KEY);
      const sym = s ? normalizeTickerInput(s) : null;
      if (sym) {
        setSymbol(sym);
        setSymbolDraft(sym);
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
        const sym = normalizeTickerInput(raw);
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

  useEffect(() => {
    if (!histSuggestOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = histSymbolComboRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setHistSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [histSuggestOpen]);

  useEffect(() => {
    setHistSuggestHighlight(0);
  }, [histSymbolDraft, histSuggestOpen]);

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
    setHistoryRows([]);
    // If the history tab is the visible one right now, flip its
    // loader on immediately so the table area shows the loader for
    // the full transition, not "empty table → loader → new rows".
    if (tab === "history") setHistLoading(true);

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

  const toggleSignalRadarExpanded = () => {
    setSignalRadarExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIGNAL_RADAR_EXPANDED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // Per-symbol snapshot is now handled by `useSymbolSnapshot` above
  // (Tier 1 → Layer 4). The previous `useEffect` here did the same
  // job imperatively but without a cache — every symbol switch was
  // a fresh round trip even when the user had just looked at that
  // ticker seconds ago. SWR replaces that with stale-while-
  // revalidate semantics; no extra effect is needed here.

  useEffect(() => {
    if (tab !== "history") return;
    let cancelled = false;
    setHistLoading(true);
    void (async () => {
      // Mode Separation rule: signal-history must be mode-isolated. While the
      // Layers / Evidence tabs already switch engine via `tradingMode`, the
      // history tab previously returned BOTH modes — a violation of "history
      // entries are associated with exactly one mode at a time" because the
      // user was looking at the swing or day engine, not a combined ledger.
      const mine = await fetchUserEvaluatedSignals({ days: 30, mode: tradingMode });
      if (cancelled) return;
      if (mine !== null) {
        setHistorySource("user");
        setHistoryRows(mine);
      } else {
        setHistorySource("public");
        setHistoryRows(await fetchLiveSignals());
      }
      setHistLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, tradingMode]);

  const filteredHistory = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    const sym = histSymbolFilter.trim().toUpperCase();
    return historyRows.filter((r) => {
      if (Number.isFinite(Date.parse(r.timestamp_iso)) && Date.parse(r.timestamp_iso) < cutoff) {
        return false;
      }
      if (sym && r.symbol.toUpperCase() !== sym) return false;
      if (histDirectionFilter !== "all" && r.bias !== histDirectionFilter) return false;
      const o = r.outcome_1d ?? r.outcome_1h;
      if (histOutcomeFilter !== "all") {
        if (histOutcomeFilter === "pending" && o != null) return false;
        if (histOutcomeFilter !== "pending" && o !== histOutcomeFilter) return false;
      }
      return true;
    });
  }, [historyRows, histSymbolFilter, histDirectionFilter, histOutcomeFilter]);

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
      if (nums.length) return nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    return rows.reduce((sum, row) => sum + row.score, 0) / Math.max(1, rows.length);
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
      rows.map((row, idx) => ({
        key: SIGNAL_LAYER_KEYS[idx] ?? row.name.toLowerCase(),
        name: row.name,
        status: row.status,
        statusLabel: row.statusLabel,
        explanation: row.explanation,
        score: row.score,
        sectorCachePending: row.sectorCachePending
      })),
    [rows]
  );

  const maturationLine = useWatchlistMaturationLine(symbol, tradingMode, dayTradingSurfaces);

  const pageDecision = useMemo(() => {
    if (!compositeResult || isInsufficientCompositeResponse(compositeResult)) return null;
    const c = compositeResult as Record<string, unknown>;
    const rr = typeof c.risk_reward === "number" && Number.isFinite(c.risk_reward) ? c.risk_reward : 1.5;
    const rrWarning = Boolean(c.rr_warning) || rr < 2.0;
    const ar = typeof c.alignment_ratio === "number" ? c.alignment_ratio : null;
    return buildSignalsPageDecision({
      bias: setupBias,
      rows: signalsPresentRows,
      signalScore: aiStripSignalScore,
      alignmentRatio: ar,
      riskReward: rr,
      rrWarning,
      isComplete: c.is_complete !== false
    });
  }, [compositeResult, setupBias, signalsPresentRows, aiStripSignalScore]);

  const previewBlockingLayers = useMemo(
    () => pickPreviewLayers(signalsPresentRows, setupBias, 3),
    [signalsPresentRows, setupBias]
  );

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
  const radarData = useMemo<Array<{ layer: string; score: number; hist: number }> | null>(() => {
    if (!compositeResult || isInsufficientCompositeResponse(compositeResult)) return null;
    const raw = compositeResult.layers;
    if (!Array.isArray(raw)) return null;
    const baseline = 50;
    return (raw as Array<Record<string, unknown>>).map((layer) => {
      const k = String(layer.layer ?? "").toLowerCase();
      const sectorPending =
        k === "sector" && String(layer.sector_resolution_state ?? "") === "pending_cache_refresh";
      const n = typeof layer.score === "number" && Number.isFinite(layer.score) ? Math.round(layer.score) : null;
      // Pending sector is excluded from composite — plot at baseline so radar/divergence shows no false skew.
      const score = sectorPending ? baseline : n ?? 0;
      return {
        layer: RADAR_LAYER_LABEL[k] ?? k,
        score,
        hist: baseline
      };
    });
  }, [compositeResult]);

  // Reset `signalEvidence` whenever the composite cache key
  // changes (symbol switch, mode flip, or a fresh insufficient
  // envelope). The evidence card is built from a *different*
  // source (the user-initiated "Show evidence" click in the
  // download handler), so we keep it as local state but tie its
  // lifecycle to the same key the composite hook uses.
  useEffect(() => {
    if (!symbol.trim() || tab !== "layers") {
      setSignalEvidence(null);
      return;
    }
    if (compositeResult === null) {
      setSignalEvidence(null);
      return;
    }
    if (isInsufficientCompositeResponse(compositeResult)) {
      setSignalEvidence(null);
    }
  }, [symbol, tab, tradingMode, compositeResult]);

  const insufficientComposite: SwingCompositeMarketStatus | null = isInsufficientCompositeResponse(compositeResult)
    ? compositeResult.market_status
    : null;
  const hasValidSignal = compositeResult !== null && !isInsufficientCompositeResponse(compositeResult);

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
    const pageId = tab === "history" ? "signals/history" : "signals/layers";
    const sym = symbol.trim().toUpperCase();
    if (!sym && tab === "layers") {
      return { page: pageId, trading_mode: tradingMode };
    }
    if (tab === "history") {
      return {
        page: pageId,
        trading_mode: tradingMode,
        symbol: sym || undefined
      };
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
    const decision = synthTradeDecision(signalEvidence, insight);
    return {
      page: pageId,
      trading_mode: tradingMode,
      symbol: sym,
      analysis_status: "loaded",
      decision_state: decision.state,
      decision_line: decision.line,
      decision_rationale: decision.rationale ?? undefined,
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
      layer_alignment_pct:
        insight.alignment_ratio != null && Number.isFinite(insight.alignment_ratio)
          ? Math.round(Math.max(0, Math.min(1, insight.alignment_ratio)) * 100)
          : null,
      layer_status: layerStatusForCtx,
      ...(gapIntelForAssistant ? { gap_intel: gapIntelForAssistant } : {})
    };
  }, [tab, tradingMode, symbol, signalEvidence, gapIntelSnapshot]);

  usePublishAssistantContext(assistantContext);

  function directionChipStyle(bias: PublicSignal["bias"]): CSSProperties {
    if (bias === "bullish") {
      return { background: "rgba(34,197,94,.2)", color: colors.bullish, border: `1px solid rgba(34,197,94,.35)` };
    }
    if (bias === "bearish") {
      return { background: "rgba(239,68,68,.2)", color: colors.bearish, border: `1px solid rgba(239,68,68,.35)` };
    }
    return { background: "rgba(245,158,11,.15)", color: colors.caution, border: `1px solid rgba(245,158,11,.35)` };
  }

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["layers", "Layer analysis"],
            ["history", "Past signal states"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-signals-tab={key}
            className="min-h-11 rounded-md px-4 text-sm"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            style={{
              border: `1px solid ${colors.border}`,
              background: tab === key ? "rgba(59,130,246,.2)" : "transparent",
              color: tab === key ? colors.accent : colors.text
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "history" ? (
        <p
          className="m-0 text-xs leading-relaxed"
          style={{ color: colors.textMuted, opacity: 0.85 }}
        >
          Historical record of evaluated signal states and their subsequent price behavior. This is not a
          trading record or recommendation.
        </p>
      ) : null}

      {tab === "history" ? (
        <article
          className={surfaceGlowClassName}
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
        >
          <h3
            style={{
              marginTop: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: spacing[2]
            }}
          >
            Signal State History
            <InfoTip
              label="About Signal State History"
              text={SIGNAL_STATE_HISTORY_TOOLTIPS.table}
              maxWidth={320}
            />
          </h3>
          <p
            className="m-0 text-sm leading-relaxed"
            style={{ color: colors.textMuted, fontStyle: "italic", marginBottom: spacing[2] }}
          >
            This view shows how price moved after STOCVEST issued a signal state. It is provided for transparency,
            not as a trading record or recommendation.
          </p>
          <p style={{ margin: `0 0 ${spacing[3]} 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
            {historySource === "user"
              ? "Your evaluated signals (signed in): last 30 days by default. Filter by ticker, signal bias, or post-signal price reaction."
              : "Platform past signal states (public feed). Sign in to include your personal evaluated signals in this list."}
          </p>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <div ref={histSymbolComboRef} className="relative min-w-[180px] flex-1">
              <input
                role="combobox"
                aria-expanded={histSuggestOpen}
                aria-controls="history-symbol-suggestions"
                aria-autocomplete="list"
                aria-label="Filter past signal states by ticker or company name"
                value={histSymbolDraft}
                autoComplete="off"
                placeholder="Ticker or company name"
                onChange={(e) => {
                  const v = e.target.value;
                  setHistSymbolDraft(v);
                  setHistSuggestOpen(true);
                  if (!v.trim()) {
                    applyHistSymbol("");
                  }
                }}
                onFocus={() => setHistSuggestOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => {
                    const raw = histSymbolDraft.trim();
                    if (!raw) {
                      applyHistSymbol("");
                      return;
                    }
                    const t = normalizeTickerFromApi(raw);
                    if (t) applyHistSymbol(t);
                  }, 120);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setHistSuggestOpen(false);
                    return;
                  }
                  if (e.key === "ArrowDown" && histSuggestionRows.length) {
                    e.preventDefault();
                    setHistSuggestOpen(true);
                    setHistSuggestHighlight((i) => Math.min(i + 1, histSuggestionRows.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp" && histSuggestionRows.length) {
                    e.preventDefault();
                    setHistSuggestHighlight((i) => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === "Enter") {
                    const pick = histSuggestionRows[histSuggestHighlight];
                    if (pick) {
                      e.preventDefault();
                      applyHistSymbol(pick.symbol);
                      return;
                    }
                    const t = normalizeTickerFromApi(histSymbolDraft);
                    if (t) {
                      e.preventDefault();
                      applyHistSymbol(t);
                    }
                  }
                }}
                className="min-h-11 w-full text-base"
                style={{
                  borderRadius: borderRadius.md,
                  border: `1px solid ${colors.border}`,
                  background: colors.surface,
                  color: colors.text,
                  padding: `${spacing[2]} ${spacing[3]}`
                }}
              />
              {histSuggestOpen &&
              (histSuggestionRows.length > 0 ||
                (histRemoteSearchLoading && histSymbolDraft.trim().length >= 2) ||
                (Boolean(histRemoteSearchError) && histSymbolDraft.trim().length >= 2)) ? (
                <ul
                  id="history-symbol-suggestions"
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border py-1 shadow-lg"
                  style={{
                    borderColor: colors.border,
                    background: colors.surface,
                    boxShadow: "0 12px 40px rgba(0,0,0,0.35)"
                  }}
                >
                  {histRemoteSearchError && histSymbolDraft.trim().length >= 2 ? (
                    <li className="px-3 py-2 text-sm leading-snug" style={{ color: colors.bearish }}>
                      {histRemoteSearchError}
                    </li>
                  ) : null}
                  {histRemoteSearchLoading &&
                  histSuggestionRows.length === 0 &&
                  histSymbolDraft.trim().length >= 2 &&
                  !histRemoteSearchError ? (
                    <li className="px-3 py-2 text-sm" style={{ color: colors.textMuted }}>
                      Searching…
                    </li>
                  ) : null}
                  {histSuggestionRows.map((row, idx) => (
                    <li key={row.symbol} role="option" aria-selected={idx === histSuggestHighlight}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm"
                        style={{
                          background:
                            idx === histSuggestHighlight ? "rgba(59,130,246,0.15)" : "transparent",
                          color: colors.text,
                          border: "none",
                          cursor: "pointer"
                        }}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => applyHistSymbol(row.symbol)}
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
                  {!histRemoteSearchLoading &&
                  !histRemoteSearchError &&
                  histSuggestionRows.length === 0 &&
                  histSymbolDraft.trim().length >= 2 ? (
                    <li className="px-3 py-2 text-sm" style={{ color: colors.textMuted }}>
                      No matching tickers. Try a symbol (e.g. AAPL) or another spelling.
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <select
                value={histDirectionFilter}
                onChange={(e) => setHistDirectionFilter(e.target.value as typeof histDirectionFilter)}
                className="min-h-11 text-base"
                aria-label="Filter past signal states by signal bias"
                style={historyFilterSelectStyle}
              >
                <option value="all" style={historyFilterOptionStyle}>
                  Any signal bias
                </option>
                <option value="bullish" style={historyFilterOptionStyle}>
                  Bullish
                </option>
                <option value="bearish" style={historyFilterOptionStyle}>
                  Bearish
                </option>
                <option value="neutral" style={historyFilterOptionStyle}>
                  Neutral
                </option>
              </select>
              <InfoTip
                label="About the signal bias filter"
                text={SIGNAL_STATE_HISTORY_TOOLTIPS.filterSignalBias}
              />
            </div>
            <div className="flex items-center gap-1">
              <select
                value={histOutcomeFilter}
                onChange={(e) => setHistOutcomeFilter(e.target.value as typeof histOutcomeFilter)}
                className="min-h-11 text-base"
                aria-label="Filter past signal states by 1-day price reaction (descriptive only — not a correctness metric)"
                style={historyFilterSelectStyle}
              >
                <option value="all" style={historyFilterOptionStyle}>
                  Any 1d price reaction
                </option>
                <option value="pending" style={historyFilterOptionStyle}>
                  Pending evaluation
                </option>
                <option value="correct" style={historyFilterOptionStyle}>
                  Moved with signal direction
                </option>
                <option value="incorrect" style={historyFilterOptionStyle}>
                  Moved against signal direction
                </option>
                <option value="neutral" style={historyFilterOptionStyle}>
                  Drifted (no clear move)
                </option>
              </select>
              <InfoTip
                label="About the price reaction filter"
                text={SIGNAL_STATE_HISTORY_TOOLTIPS.filterPriceReaction}
              />
            </div>
          </div>
          {histLoading ? (
            <CuteLoader label="Loading signal history" sublabel="Reading recent state records" compact />
          ) : filteredHistory.length === 0 ? (
            <p style={{ color: colors.textMuted, margin: 0 }}>
              Signal history builds automatically as signals are generated. Check back after market hours.
            </p>
          ) : (
            <div className="-mx-1 overflow-x-auto px-1 sm:mx-0 sm:px-0" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="min-w-[880px]" style={{ width: "100%", borderCollapse: "collapse", fontSize: typography.scale.sm }}>
                <thead>
                  <tr style={{ color: colors.textMuted, textAlign: "left" }}>
                    <th style={{ padding: spacing[2] }}>
                      <span className="inline-flex items-center gap-1">
                        Time
                        <InfoTip label="About Time" text={SIGNAL_STATE_HISTORY_TOOLTIPS.colTime} />
                      </span>
                    </th>
                    <th style={{ padding: spacing[2] }}>
                      <span className="inline-flex items-center gap-1">
                        Symbol
                        <InfoTip label="About Symbol" text={SIGNAL_STATE_HISTORY_TOOLTIPS.colSymbol} />
                      </span>
                    </th>
                    <th style={{ padding: spacing[2] }}>
                      <span className="inline-flex items-center gap-1">
                        Signal bias
                        <InfoTip label="About Signal bias" text={SIGNAL_STATE_HISTORY_TOOLTIPS.colSignalBias} />
                      </span>
                    </th>
                    <th style={{ padding: spacing[2] }}>
                      <span className="inline-flex items-center gap-1">
                        Alignment
                        <InfoTip label="About Alignment" text={SIGNAL_STATE_HISTORY_TOOLTIPS.colAlignment} />
                      </span>
                    </th>
                    <th style={{ padding: spacing[2] }}>
                      <span className="inline-flex items-center gap-1">
                        Pattern
                        <InfoTip label="About Pattern" text={SIGNAL_STATE_HISTORY_TOOLTIPS.colPattern} />
                      </span>
                    </th>
                    <th style={{ padding: spacing[2] }}>
                      <span className="inline-flex items-center gap-1">
                        Price at signal
                        <InfoTip
                          label="About Price at signal"
                          text={SIGNAL_STATE_HISTORY_TOOLTIPS.colPriceAtSignal}
                        />
                      </span>
                    </th>
                    <th style={{ padding: spacing[2] }}>
                      <span className="inline-flex items-center gap-1">
                        1h price reaction
                        <InfoTip
                          label="About 1h price reaction"
                          text={SIGNAL_STATE_HISTORY_TOOLTIPS.col1hReaction}
                          maxWidth={320}
                        />
                      </span>
                    </th>
                    <th style={{ padding: spacing[2] }}>
                      <span className="inline-flex items-center gap-1">
                        1d price reaction
                        <InfoTip
                          label="About 1d price reaction"
                          text={SIGNAL_STATE_HISTORY_TOOLTIPS.col1dReaction}
                          maxWidth={320}
                        />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((row) => {
                    const h1 = formatHorizonOutcome(row.outcome_1h);
                    const h1d = formatHorizonOutcome(row.outcome_1d);
                    const alignment = formatLayerAlignmentBucket(row.signal_strength);
                    return (
                      <tr key={row.signal_id ?? `${row.symbol}-${row.timestamp_iso}`} style={{ borderTop: `1px solid ${colors.border}` }}>
                        <td style={{ padding: spacing[2], whiteSpace: "nowrap" }}>{new Date(row.timestamp_iso).toLocaleString()}</td>
                        <td style={{ padding: spacing[2] }}>{row.symbol}</td>
                        <td style={{ padding: spacing[2] }}>
                          <span
                            style={{
                              ...directionChipStyle(row.bias),
                              borderRadius: borderRadius.full,
                              padding: "2px 10px",
                              fontSize: typography.scale.xs,
                              textTransform: "capitalize",
                              display: "inline-block"
                            }}
                          >
                            {row.bias}
                          </span>
                        </td>
                        <td
                          style={{ padding: spacing[2] }}
                          title="Layer alignment at issuance — High / Moderate / Low. Not a probability or correctness metric."
                        >
                          {alignment}
                        </td>
                        <td style={{ padding: spacing[2] }}>{row.pattern ?? "—"}</td>
                        <td style={{ padding: spacing[2] }}>
                          {typeof row.price_at_signal === "number" ? `$${row.price_at_signal.toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: spacing[2] }}>{h1.label}</td>
                        <td style={{ padding: spacing[2] }}>{h1d.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      ) : null}

      {tab === "layers" ? (
        <>
      <div ref={symbolComboRef} className="relative w-full min-w-0 sm:max-w-xl">
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
                const t = normalizeTickerFromApi(raw);
                if (!t) return;
                if (t === symbol.toUpperCase()) return;
                // Free-text on blur: only commit when corroborated. Otherwise leave the draft
                // visible and let the user pick from suggestions or correct the spelling.
                if (isSymbolCorroborated(t)) {
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
                const t = normalizeTickerFromApi(symbolDraft);
                if (!t) return;
                e.preventDefault();
                // Explicit free-text submit: pause and explain rather than silently commit a
                // ticker the system can't corroborate (typeahead / watchlist / Polygon search).
                if (isSymbolCorroborated(t)) {
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
          (remoteSearchLoading && symbolDraft.trim().length >= 2) ||
          (Boolean(remoteSearchError) && symbolDraft.trim().length >= 2)) ? (
          <ul
            id="signal-symbol-suggestions"
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border py-1 shadow-lg sm:left-auto sm:right-auto sm:min-w-full"
            style={{
              borderColor: colors.border,
              background: colors.surface,
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)"
            }}
          >
            {remoteSearchError && symbolDraft.trim().length >= 2 ? (
              <li className="px-3 py-2 text-sm leading-snug" style={{ color: colors.bearish }}>
                {remoteSearchError}
              </li>
            ) : null}
            {remoteSearchLoading && suggestionRows.length === 0 && symbolDraft.trim().length >= 2 && !remoteSearchError ? (
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
            symbolDraft.trim().length >= 2 ? (
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
      <SignalsCommandBar
        symbol={symbol}
        tradingMode={tradingMode}
        dayTradingSurfaces={dayTradingSurfaces}
        watchlistControl={<AddToWatchlistButton symbol={symbol} dualDeskTracking={dayTradingSurfaces} />}
        maturationLine={maturationLine}
        onTradingModeChange={updateTradingMode}
      />

      {hasValidSignal && pageDecision ? (
        <SignalsSetupRead
          symbol={symbol}
          tradingMode={tradingMode}
          bias={setupBias}
          rows={signalsPresentRows}
          decision={pageDecision}
          previewLayers={previewBlockingLayers}
          onOpenEvidence={() => void openEvidenceModal()}
          onSwitchToHistory={() => setTab("history")}
        />
      ) : null}

      {hasValidSignal ? (
        <SignalsReferenceLevels
          levels={referenceLevels}
          setupPattern={setup?.triggers[0] ?? null}
        />
      ) : null}

      <div className="signals-grid grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.35fr_1fr] [&>*]:min-w-0">
        <div className="order-2 min-w-0 lg:order-1">
          <SignalsLayerBreakdown
            symbol={symbol}
            tradingMode={tradingMode}
            bias={setupBias}
            rows={signalsPresentRows}
            loading={compositeResult === null}
            insufficient={Boolean(insufficientComposite)}
            insufficientMessage={insufficientLayerMessage}
          />
        </div>

        {hasValidSignal && radarData ? (
          <section
            className={`order-1 min-w-0 lg:order-2 ${surfaceGlowClassName}`}
            style={{
              background: colors.surface,
              border: `1px solid ${
                signalRadarExpanded
                  ? colors.border
                  : `color-mix(in srgb, ${colors.border} 55%, transparent)`
              }`,
              borderRadius: borderRadius.xl,
              padding: spacing[4],
              opacity: signalRadarExpanded ? 1 : 0.92
            }}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3
                style={{
                  marginTop: 0,
                  ...(signalRadarExpanded
                    ? null
                    : { fontSize: typography.scale.base, fontWeight: 600 })
                }}
              >
                Signal Radar
              </h3>
              <button
                type="button"
                className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-medium"
                style={{ border: `1px solid ${colors.border}`, color: colors.textMuted, background: colors.surfaceMuted }}
                aria-expanded={signalRadarExpanded}
                onClick={toggleSignalRadarExpanded}
              >
                {signalRadarExpanded ? (
                  <>
                    <ChevronUp size={14} aria-hidden />
                    Collapse
                  </>
                ) : (
                  <>
                    <ChevronDown size={14} aria-hidden />
                    Expand radar
                  </>
                )}
              </button>
            </div>
            {!signalRadarExpanded ? (
              <p className="m-0 text-sm leading-relaxed" style={{ color: colors.textMuted }}>
                Shows how current conditions differ from a typical baseline — expand for the chart and per-layer gap
                bars; the written breakdown stays the main read.
              </p>
            ) : (
              <>
                <p className="text-sm" style={{ margin: `0 0 ${spacing[2]} 0`, color: colors.textMuted }}>
                  Shows how current conditions differ from a typical baseline — dashed ring is typical, solid fill is
                  today.
                </p>
                <div
                  className="flex flex-wrap items-center gap-x-4 gap-y-2"
                  style={{ margin: `0 0 ${spacing[3]} 0`, fontSize: 12, color: colors.textMuted }}
                  aria-label="Radar chart legend"
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block shrink-0 rounded-sm"
                      style={{ width: 12, height: 12, background: "#0ea5e9", opacity: 0.85, border: "1px solid #38bdf8" }}
                      aria-hidden
                    />
                    Current
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block shrink-0 rounded-sm"
                      style={{
                        width: 12,
                        height: 12,
                        border: `2px dashed ${colors.text}`,
                        background: "transparent",
                        opacity: 0.85
                      }}
                      aria-hidden
                    />
                    Typical baseline
                  </span>
                </div>
                <div className="mx-auto w-full min-w-0 max-w-full">
                  {/* One chart only: a display:none sibling gives ResponsiveContainer 0×0 and Recharts warns. */}
                  <div
                    className="mx-auto w-full max-w-full min-w-0 overflow-hidden"
                    style={{ height: isMobileLayout ? 256 : 288 }}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart
                        data={radarData}
                        margin={
                          isMobileLayout
                            ? { top: 16, right: 18, bottom: 22, left: 18 }
                            : { top: 18, right: 20, bottom: 26, left: 20 }
                        }
                      >
                        <PolarGrid stroke={colors.border} />
                        <PolarAngleAxis
                          dataKey="layer"
                          tick={{ fill: colors.textMuted, fontSize: isMobileLayout ? 10 : 11 }}
                          tickLine={false}
                        />
                        <PolarRadiusAxis
                          angle={30}
                          domain={[0, 100]}
                          tick={{ fill: colors.textMuted, fontSize: isMobileLayout ? 9 : 10 }}
                        />
                        <Radar
                          name="Typical baseline"
                          dataKey="hist"
                          stroke={colors.text}
                          strokeWidth={2}
                          strokeDasharray="5 4"
                          fill="none"
                          dot={false}
                          isAnimationActive={false}
                        />
                        <Radar
                          name="Current"
                          dataKey="score"
                          stroke="#38bdf8"
                          strokeWidth={2}
                          fill="#0ea5e9"
                          fillOpacity={0.38}
                          dot={false}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <h4 style={{ margin: `${spacing[4]} 0 ${spacing[1]} 0`, fontSize: 13, fontWeight: 600, color: colors.text }}>
                  Today vs typical (per layer)
                </h4>
                <p className="text-xs leading-snug" style={{ margin: `0 0 ${spacing[2]} 0`, color: colors.textMuted }}>
                  Shows how each layer today differs from its typical baseline (today − typical on the radar). Color key
                  is directly above the bars.
                </p>
                <SignalLayerDivergenceChart data={radarData} colors={colors} height={isMobileLayout ? 348 : 312} />
              </>
            )}
          </section>
        ) : null}

      </div>

      {showAfterHoursPanel ? (
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
      ) : null}
        </>
      ) : null}
        </>
      ) : null}
      <SignalEvidenceModal
        open={evidenceOpen}
        evidence={signalEvidence}
        onClose={() => setEvidenceOpen(false)}
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
