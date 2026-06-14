"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { DeskModeTabNav } from "@/components/desk-mode-tab-nav";
import { MarketEnvironmentStrip } from "@/components/market-environment-strip";
import { useMarketEnvironment } from "@/lib/hooks/use-market-environment";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CuteLoader } from "@/components/cute-loader";
import { WatchlistAlignmentSheet } from "@/components/watchlists/watchlist-alignment-sheet";
import { WatchlistDeskCompareSheet } from "@/components/watchlists/watchlist-desk-compare-sheet";
import { WatchlistActivityCollapsible } from "@/components/watchlists/WatchlistActivityCollapsible";
import { WatchlistDecisionQueue } from "@/components/watchlists/watchlist-decision-queue";
import { WatchlistOrderExplainer } from "@/components/watchlists/watchlist-order-explainer";
import { WatchlistSortControl } from "@/components/watchlists/watchlist-sort-control";
import { WatchlistTrackingDensityToggle } from "@/components/watchlists/watchlist-tracking-density-toggle";
import { WatchlistStatusRails } from "@/components/watchlists/WatchlistStatusRails";
import { WatchlistEvaluationInfoTip } from "@/components/watchlists/WatchlistEvaluationInfoTip";
import {
  formatWatchlistMaturationDisplayLine,
  resolveAlignmentDisplayTier
} from "@/lib/alignment-display-tier";
import { buildWatchlistPortfolioHeadline } from "@/lib/watchlist-row-present";
import { formatSummaryFetchedAt, watchlistMaturationDeskSummary } from "@/lib/watchlist-evaluation-present";
import { isTickerSearchQueryReady } from "@/lib/ticker-search-query";
import {
  primeWatchlistSymbolMaturation,
  refreshWatchlistSymbolMaturationDesk,
  type WatchlistMaturationDesk
} from "@/lib/watchlist-maturation-prime";
import { useWatchlistSessionRefresh } from "@/lib/hooks/use-watchlist-session-refresh";
import type { WatchlistMaturationDesk as SessionRefreshDesk } from "@/lib/watchlist-maturation-session-staleness";
import { APP_CHROME_LAYOUT_HEIGHT_PX, measureAppChromeLayoutHeightPx } from "@/lib/app-chrome-layout";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { watchlistSignalsOpenAriaLabel, watchlistToSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";
import type { MarketStatusPayload, SnapshotPayload } from "@/lib/api/market";
import { isRegularSessionOpen } from "@/lib/market/regular-session";
import {
  consumeWatchlistMaturationBump,
  WATCHLIST_MATURATION_UPDATED_EVENT
} from "@/lib/watchlist-maturation-bump";
import { rankSymbolCandidates } from "@/lib/symbol-suggestion-rank";
import { buildRankedSymbolSuggestions } from "@/lib/symbol-typeahead";
import {
  dedupeWatchlistSymbolsUpper as dedupeSymbolsUpper,
  formatWatchlistMaturationLabel as formatStateLabel,
  normalizeWatchlistMaturationBySymbol as normalizeMaturationBySymbol,
  watchlistMaturationRowForDesk,
  parseCompanyNameFromTickerCandidateLabel,
  watchlistQuoteFromSnapshot,
  watchlistSymbolMatchesSearch,
  type WatchlistMaturationRow as MaturationRow,
  type WatchlistViewMode
} from "@/lib/watchlist-page-utils";
import { canonicalUsTicker, isWellFormedUsTicker } from "@/lib/symbol-ticker";
import { useTheme } from "@/lib/theme-provider";
import {
  resolveWatchlistAttentionTier,
  watchlistAttentionSectionMeta,
  type WatchlistAttentionTier
} from "@/lib/watchlist-decision-card-present";
import { focusWatchlistRow } from "@/lib/watchlist-row-focus";
import { FLOATING_SURFACE_CLASS } from "@/lib/overlay-classes";
import {
  symbolMatchesMaturationRail,
  WATCHLIST_MATURATION_RAIL_LABELS,
  type WatchlistMaturationRailKey
} from "@/lib/watchlist-maturation-rails";
import {
  readWatchlistTrackingCompact,
  writeWatchlistTrackingCompact
} from "@/lib/watchlist-display-preference";
import {
  readWatchlistSortMode,
  writeWatchlistSortMode,
  type WatchlistSortMode
} from "@/lib/watchlist-sort-preference";
import { useWatchlistDeskContext } from "@/lib/hooks/use-watchlist-desk-context";
import {
  compareSymbolsByPresentationPriority,
  maturationAlertPassesTracking,
  parseMaturationModeFromAlertBody,
  shouldShowDeskRow,
  trackingForSymbol,
  type SymbolTrackingMap
} from "@/lib/watchlist-tracking-presentation";

import {
  displayStateForSymbol,
  parseTickerInput,
  QUICK,
  tradingModeForSignalsNav,
  type MaturationAlertFeedItem,
  type SymbolCandidate,
  type WatchlistAddSuggestion,
  type WatchlistRow,
  type WatchlistsPageClientProps
} from "./watchlists-page-helpers";

export function WatchlistsPageClient(props: WatchlistsPageClientProps = {}) {
  const {
    dualDeskMaturation = false,
    planBadgeLabel = "Free",
    subscriptionPlan = "free",
    maxSymbols = 5
  } = props;
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { colors, theme } = useTheme();
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState("");
  const [symErr, setSymErr] = useState<string | null>(null);
  const [maturationReloadNonce, setMaturationReloadNonce] = useState(0);
  const [maturationSummaryFetchedAt, setMaturationSummaryFetchedAt] = useState<Date | null>(null);
  const [evaluatingSymbols, setEvaluatingSymbols] = useState<Record<string, { swing?: boolean; day?: boolean }>>(
    {}
  );
  const [maturationSwing, setMaturationSwing] = useState<Record<string, MaturationRow>>({});
  const [maturationDay, setMaturationDay] = useState<Record<string, MaturationRow>>({});
  const [maturationFetchStatus, setMaturationFetchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const maturationHasLoadedRef = useRef(false);
  const [maturationStorageReady, setMaturationStorageReady] = useState<boolean | null>(null);
  const [viewMode, setViewMode] = useState<WatchlistViewMode>("swing");
  const [maturationAlerts, setMaturationAlerts] = useState<MaturationAlertFeedItem[]>([]);
  const [maturationAlertsStatus, setMaturationAlertsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [addSuggestOpen, setAddSuggestOpen] = useState(false);
  const [addSuggestHighlight, setAddSuggestHighlight] = useState(0);
  const [addRemoteCandidates, setAddRemoteCandidates] = useState<SymbolCandidate[]>([]);
  const [addRemoteSearchLoading, setAddRemoteSearchLoading] = useState(false);
  const [addRemoteSearchError, setAddRemoteSearchError] = useState<string | null>(null);
  const addComboRef = useRef<HTMLDivElement | null>(null);
  const [snapshotsBySymbol, setSnapshotsBySymbol] = useState<Record<string, SnapshotPayload>>({});
  const [snapshotFetchStatus, setSnapshotFetchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [marketStatus, setMarketStatus] = useState<MarketStatusPayload | null>(null);
  const [alignmentSheet, setAlignmentSheet] = useState<{
    symbol: string;
    deskMode: "swing" | "day";
  } | null>(null);
  const [compareSheetSymbol, setCompareSheetSymbol] = useState<string | null>(null);
  const [forceOpenTiers, setForceOpenTiers] = useState<WatchlistAttentionTier[]>([]);
  const [maturationRailFilter, setMaturationRailFilter] = useState<WatchlistMaturationRailKey | null>(null);
  const [justAddedSymbol, setJustAddedSymbol] = useState<string | null>(null);
  const [watchlistToast, setWatchlistToast] = useState<{ message: string; symbol: string } | null>(null);
  const [sortMode, setSortMode] = useState<WatchlistSortMode>("attention");
  const [trackingCompact, setTrackingCompact] = useState(false);

  const alignmentSheetRow: MaturationRow | undefined = alignmentSheet
    ? alignmentSheet.deskMode === "day"
      ? maturationDay[alignmentSheet.symbol]
      : maturationSwing[alignmentSheet.symbol]
    : undefined;

  useEffect(() => {
    setSortMode(readWatchlistSortMode());
    setTrackingCompact(readWatchlistTrackingCompact());
  }, []);

  const watchlistHeaderRef = useRef<HTMLElement | null>(null);
  const [watchlistTopBarPx, setWatchlistTopBarPx] = useState(APP_CHROME_LAYOUT_HEIGHT_PX);

  const handleSortModeChange = useCallback((mode: WatchlistSortMode) => {
    setSortMode(mode);
    writeWatchlistSortMode(mode);
  }, []);

  const handleTrackingCompactChange = useCallback((compact: boolean) => {
    setTrackingCompact(compact);
    writeWatchlistTrackingCompact(compact);
  }, []);

  useEffect(() => {
    if (loading) return;
    const focus = (searchParams.get("focus") ?? "").trim().toUpperCase();
    if (!focus) return;
    const ms = maturationSwing[focus];
    const md = maturationDay[focus];
    const row = watchlistMaturationRowForDesk(viewMode, ms, md);
    setForceOpenTiers([resolveWatchlistAttentionTier(row)]);
    window.requestAnimationFrame(() => {
      focusWatchlistRow(focus, colors.accent);
    });
  }, [loading, searchParams, colors.accent, maturationSwing, maturationDay, viewMode]);

  useEffect(() => {
    if (!watchlistToast) return;
    const t = window.setTimeout(() => setWatchlistToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [watchlistToast]);

  useEffect(() => {
    if (!justAddedSymbol) return;
    const t = window.setTimeout(() => {
      setJustAddedSymbol((s) => (s === justAddedSymbol ? null : s));
    }, 30_000);
    return () => window.clearTimeout(t);
  }, [justAddedSymbol]);

  useEffect(() => {
    if (!dualDeskMaturation && viewMode !== "swing") setViewMode("swing");
  }, [dualDeskMaturation, viewMode]);

  const decisionPlanMode = useMemo(
    () => tradingModeForSignalsNav(viewMode, dualDeskMaturation),
    [viewMode, dualDeskMaturation]
  );
  const watchlistDesk = useWatchlistDeskContext(decisionPlanMode);
  const deskMarketEnvironment = useMarketEnvironment(viewMode === "day" ? "day" : "swing", {
    macroRegime: watchlistDesk.regimeLabel ?? null
  });

  const nearReadyFilterActive = searchParams.get("near_ready") === "1";
  const actionableRailFromUrl = searchParams.get("rail") === "actionable";

  useEffect(() => {
    const desk = (searchParams.get("desk") ?? "").trim().toLowerCase();
    if (desk === "day" && dualDeskMaturation) setViewMode("day");
    else if (desk === "swing" || desk === "both") setViewMode("swing");
  }, [searchParams, dualDeskMaturation]);

  useEffect(() => {
    if (actionableRailFromUrl) setMaturationRailFilter("actionable");
  }, [actionableRailFromUrl]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stocvest/watchlists", { cache: "no-store" });
      const data = (await res.json()) as { watchlists?: WatchlistRow[]; message?: string };
      if (!res.ok) throw new Error(data.message || "Failed to load watchlists");
      let list = data.watchlists ?? [];
      if (list.length === 0) {
        const cr = await fetch("/api/stocvest/watchlists", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "My Watchlist", symbols: [], is_default: true })
        });
        const created = (await cr.json()) as WatchlistRow & { message?: string };
        if (!cr.ok) throw new Error(created.message || "Failed to create watchlist");
        list = [created];
      }
      setRows(
        list.map((w) => ({
          ...w,
          symbols: dedupeSymbolsUpper(w.symbols)
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => rows[0] ?? null, [rows]);

  /** Match sticky header offset to the live fixed top bar height. */
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => {
      const topBarPx = measureAppChromeLayoutHeightPx();
      setWatchlistTopBarPx((prev) => (prev === topBarPx ? prev : topBarPx));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  /** Maturation API is keyed to the default list; with a single list we always surface it. */
  const maturationEligible = Boolean(active && (active.is_default || rows.length <= 1));

  function readMaturationStorageReady(payload: unknown): boolean | null {
    if (!payload || typeof payload !== "object") return null;
    const ready = (payload as { storage_ready?: boolean }).storage_ready;
    return typeof ready === "boolean" ? ready : null;
  }

  const activeSymbolsDeduped = useMemo(() => dedupeSymbolsUpper(active?.symbols ?? []), [active?.symbols]);

  const watchlistAssistantContext = useMemo(
    () => ({
      page: "dashboard/watchlists" as const,
      subscription_plan: subscriptionPlan,
      watchlist_max_symbols: maxSymbols,
      watchlist_symbol_count: activeSymbolsDeduped.length,
      decision_line:
        "Watchlist maturation runs on weekdays after ~4:30 PM ET or when you open Evidence on Signals. Ask how evaluation cadence and layer bands work."
    }),
    [subscriptionPlan, maxSymbols, activeSymbolsDeduped.length]
  );
  usePublishAssistantContext(watchlistAssistantContext);

  const symbolTrackingMap = useMemo((): SymbolTrackingMap => {
    const raw = active?.symbol_tracking;
    if (!raw || typeof raw !== "object") return {};
    const out: SymbolTrackingMap = {};
    for (const sym of activeSymbolsDeduped) {
      const row = raw[sym];
      if (row && typeof row === "object") {
        out[sym] = { swing: Boolean(row.swing), day: Boolean(row.day) };
      }
    }
    return out;
  }, [active?.symbol_tracking, activeSymbolsDeduped]);

  useEffect(() => {
    if (!maturationEligible || activeSymbolsDeduped.length === 0) {
      setMaturationSwing({});
      setMaturationDay({});
      setMaturationFetchStatus("idle");
      setMaturationSummaryFetchedAt(null);
      setMaturationStorageReady(null);
      maturationHasLoadedRef.current = false;
      return;
    }
    if (!maturationHasLoadedRef.current) {
      setMaturationFetchStatus("loading");
    }
    setMaturationStorageReady(null);
    let cancelled = false;
    void (async () => {
      try {
        if (dualDeskMaturation) {
          const [swRes, dyRes] = await Promise.all([
            fetch(`/api/stocvest/watchlists/maturation-summary?${new URLSearchParams({ mode: "swing" })}`, {
              cache: "no-store",
              credentials: "same-origin"
            }),
            fetch(`/api/stocvest/watchlists/maturation-summary?${new URLSearchParams({ mode: "day" })}`, {
              cache: "no-store",
              credentials: "same-origin"
            })
          ]);
          const swJson = (await swRes.json().catch(() => ({}))) as unknown;
          const dyJson = (await dyRes.json().catch(() => ({}))) as unknown;
          if (cancelled) return;
          const swDegraded =
            !swRes.ok ||
            (typeof swJson === "object" &&
              swJson !== null &&
              "degraded" in swJson &&
              Boolean((swJson as { degraded?: boolean }).degraded));
          const dyDegraded =
            !dyRes.ok ||
            (typeof dyJson === "object" &&
              dyJson !== null &&
              "degraded" in dyJson &&
              Boolean((dyJson as { degraded?: boolean }).degraded));
          if (swDegraded && dyDegraded) {
            setMaturationSwing({});
            setMaturationDay({});
            if (swRes.status >= 500 || dyRes.status >= 500) {
              setMaturationFetchStatus("ready");
              setMaturationSummaryFetchedAt(new Date());
              maturationHasLoadedRef.current = true;
              return;
            }
            setMaturationFetchStatus("error");
            return;
          }
          setMaturationSwing(swDegraded ? {} : normalizeMaturationBySymbol(swJson));
          setMaturationDay(dyDegraded ? {} : normalizeMaturationBySymbol(dyJson));
          setMaturationStorageReady(
            readMaturationStorageReady(swJson) ?? readMaturationStorageReady(dyJson)
          );
        } else {
          const res = await fetch(`/api/stocvest/watchlists/maturation-summary?${new URLSearchParams({ mode: "swing" })}`, {
            cache: "no-store",
            credentials: "same-origin"
          });
          const json = (await res.json().catch(() => ({}))) as unknown;
          if (cancelled) return;
          if (!res.ok) {
            const degraded =
              res.status >= 500 ||
              (typeof json === "object" &&
                json !== null &&
                "degraded" in json &&
                Boolean((json as { degraded?: boolean }).degraded));
            if (degraded) {
              setMaturationSwing({});
              setMaturationDay({});
              setMaturationFetchStatus("ready");
              setMaturationSummaryFetchedAt(new Date());
              maturationHasLoadedRef.current = true;
              return;
            }
            setMaturationSwing({});
            setMaturationDay({});
            setMaturationFetchStatus("error");
            return;
          }
          setMaturationSwing(normalizeMaturationBySymbol(json));
          setMaturationDay({});
          setMaturationStorageReady(readMaturationStorageReady(json));
        }
        setMaturationFetchStatus("ready");
        setMaturationSummaryFetchedAt(new Date());
        maturationHasLoadedRef.current = true;
      } catch {
        if (!cancelled) {
          setMaturationSwing({});
          setMaturationDay({});
          setMaturationFetchStatus("error");
          setMaturationSummaryFetchedAt(null);
          maturationHasLoadedRef.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    active?.watchlist_id,
    maturationEligible,
    activeSymbolsDeduped.join(","),
    dualDeskMaturation,
    maturationReloadNonce
  ]);

  const maturationReloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestMaturationReload = useCallback(() => {
    if (!maturationEligible || activeSymbolsDeduped.length === 0) return;
    if (maturationReloadDebounceRef.current) clearTimeout(maturationReloadDebounceRef.current);
    maturationReloadDebounceRef.current = setTimeout(() => {
      maturationReloadDebounceRef.current = null;
      setMaturationReloadNonce((n) => n + 1);
    }, 400);
  }, [maturationEligible, activeSymbolsDeduped.length]);

  useEffect(() => {
    return () => {
      if (maturationReloadDebounceRef.current) clearTimeout(maturationReloadDebounceRef.current);
    };
  }, []);

  const sessionRefreshDesks = useMemo((): SessionRefreshDesk[] => {
    if (dualDeskMaturation) return ["swing", "day"];
    return viewMode === "day" ? ["day"] : ["swing"];
  }, [dualDeskMaturation, viewMode]);

  useWatchlistSessionRefresh({
    enabled: maturationEligible && active?.is_default === true,
    symbols: activeSymbolsDeduped,
    swingBySymbol: maturationSwing,
    dayBySymbol: maturationDay,
    desks: sessionRefreshDesks,
    maturationReady: maturationFetchStatus === "ready",
    onRefreshed: requestMaturationReload
  });

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (consumeWatchlistMaturationBump()) requestMaturationReload();
    };
    const onMaturationUpdated = () => requestMaturationReload();
    const onFocus = () => {
      if (consumeWatchlistMaturationBump()) requestMaturationReload();
    };
    const onPageShow = () => {
      if (consumeWatchlistMaturationBump()) requestMaturationReload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(WATCHLIST_MATURATION_UPDATED_EVENT, onMaturationUpdated);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(WATCHLIST_MATURATION_UPDATED_EVENT, onMaturationUpdated);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [requestMaturationReload]);

  useEffect(() => {
    if (!pathname?.includes("/dashboard/watchlists")) return;
    if (consumeWatchlistMaturationBump()) requestMaturationReload();
  }, [pathname, requestMaturationReload]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/stocvest/market/status", {
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json().catch(() => null)) as MarketStatusPayload | null;
        if (!cancelled && data && typeof data === "object") setMarketStatus(data);
      } catch {
        /* quotes/maturation still work without session badge */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sessionClosed = useMemo(
    () => Boolean(marketStatus?.market?.trim()) && !isRegularSessionOpen(marketStatus),
    [marketStatus]
  );

  useEffect(() => {
    const syms = activeSymbolsDeduped.slice(0, maxSymbols);
    if (syms.length === 0) {
      setSnapshotsBySymbol({});
      setSnapshotFetchStatus("idle");
      return;
    }
    let cancelled = false;
    setSnapshotFetchStatus("loading");
    void (async () => {
      const merged: Record<string, SnapshotPayload> = {};
      try {
        for (let i = 0; i < syms.length; i += 20) {
          const chunk = syms.slice(i, i + 20);
          if (chunk.length === 0) break;
          const res = await fetch(`/api/stocvest/market/snapshots?symbols=${encodeURIComponent(chunk.join(","))}`, {
            cache: "no-store",
            credentials: "same-origin"
          });
          if (!res.ok) continue;
          const data = (await res.json().catch(() => ({}))) as { snapshots?: unknown[] };
          for (const raw of data.snapshots ?? []) {
            if (!raw || typeof raw !== "object") continue;
            const row = raw as SnapshotPayload;
            const sym = String(row.symbol ?? "")
              .trim()
              .toUpperCase();
            if (sym) merged[sym] = row;
          }
        }
        if (!cancelled) {
          setSnapshotsBySymbol(merged);
          setSnapshotFetchStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setSnapshotsBySymbol({});
          setSnapshotFetchStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.watchlist_id, activeSymbolsDeduped.join(",")]);

  useEffect(() => {
    if (!maturationEligible || activeSymbolsDeduped.length === 0) {
      setMaturationAlerts([]);
      setMaturationAlertsStatus("idle");
      return;
    }
    setMaturationAlertsStatus("loading");
    let cancelled = false;
    void (async () => {
      try {
        const listSyms = activeSymbolsDeduped.slice(0, 50);
        const qs = new URLSearchParams({
          limit: "12",
          alert_type: "watchlist_maturation",
          symbols: listSyms.join(",")
        });
        const res = await fetch(`/api/stocvest/alerts/history?${qs.toString()}`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { alerts?: unknown[] };
        if (cancelled) return;
        if (!res.ok) {
          setMaturationAlerts([]);
          setMaturationAlertsStatus("error");
          return;
        }
        const out: MaturationAlertFeedItem[] = [];
        for (const raw of data.alerts ?? []) {
          if (!raw || typeof raw !== "object") continue;
          const a = raw as Record<string, unknown>;
          if (String(a.alert_type ?? "").trim() !== "watchlist_maturation") continue;
          const sym = String(a.symbol ?? "")
            .trim()
            .toUpperCase();
          if (!sym) continue;
          const mode = parseMaturationModeFromAlertBody(a.body);
          if (!maturationAlertPassesTracking(sym, mode, symbolTrackingMap, dualDeskMaturation)) continue;
          out.push({
            title: String(a.title ?? "Maturation update"),
            created_at: String(a.created_at ?? ""),
            symbol: sym,
            mode
          });
        }
        setMaturationAlerts(out.slice(0, 8));
        setMaturationAlertsStatus("ready");
      } catch {
        if (!cancelled) {
          setMaturationAlerts([]);
          setMaturationAlertsStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    active?.watchlist_id,
    maturationEligible,
    activeSymbolsDeduped.join(","),
    symbolTrackingMap,
    dualDeskMaturation
  ]);

  const localAddCandidates = useMemo((): SymbolCandidate[] => {
    const onList = new Set(activeSymbolsDeduped);
    const m = new Map<string, SymbolCandidate>();
    for (const raw of QUICK) {
      const sym = parseTickerInput(raw) || canonicalUsTicker(raw);
      if (!sym || onList.has(sym)) continue;
      m.set(sym, { symbol: sym, label: sym });
    }
    return Array.from(m.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [activeSymbolsDeduped]);

  useEffect(() => {
    const q = addDraft.trim();
    if (!isTickerSearchQueryReady(q)) {
      setAddRemoteCandidates([]);
      setAddRemoteSearchLoading(false);
      setAddRemoteSearchError(null);
      return;
    }
    let cancelled = false;
    setAddRemoteSearchLoading(true);
    setAddRemoteSearchError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/stocvest/market/tickers-search?q=${encodeURIComponent(q)}`, {
            credentials: "same-origin",
            cache: "no-store"
          });
          if (cancelled) return;
          if (!res.ok) {
            setAddRemoteSearchError(`Search failed (${res.status}). Try a known symbol.`);
            setAddRemoteCandidates([]);
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
            setAddRemoteCandidates(next);
            setAddRemoteSearchError(next.length === 0 && bodyError ? bodyError : null);
          }
        } catch {
          if (!cancelled) {
            setAddRemoteCandidates([]);
            setAddRemoteSearchError("Network error while searching tickers.");
          }
        } finally {
          if (!cancelled) setAddRemoteSearchLoading(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setAddRemoteSearchLoading(false);
    };
  }, [addDraft]);

  /** Issuer names from Polygon ticker-search — used when row snapshots are still empty. */
  const remoteCompanyBySymbol = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of addRemoteCandidates) {
      const sym = c.symbol.trim().toUpperCase();
      const nm = parseCompanyNameFromTickerCandidateLabel(c.label, sym);
      if (nm) m.set(sym, nm);
    }
    return m;
  }, [addRemoteCandidates]);

  const addSuggestionRows = useMemo((): WatchlistAddSuggestion[] => {
    const q = addDraft.trim();
    const onListSet = new Set(activeSymbolsDeduped);
    const onListAsCandidates: SymbolCandidate[] = activeSymbolsDeduped.map((sym) => {
      const snap = snapshotsBySymbol[sym];
      const name =
        (snap?.company_name ?? "").trim() || remoteCompanyBySymbol.get(sym) || "";
      const ms = maturationSwing[sym];
      const md = maturationDay[sym];
      let matSnippet = "";
      const activeRow = watchlistMaturationRowForDesk(
        viewMode,
        ms,
        dualDeskMaturation ? md : undefined
      );
      matSnippet = [formatWatchlistMaturationDisplayLine(activeRow) ?? formatStateLabel(activeRow), activeRow?.readiness_label]
        .filter(Boolean)
        .join(" ")
        .trim();
      const base = name ? `${sym} — ${name}` : sym;
      const label = matSnippet && matSnippet !== "—" ? `${base} ${matSnippet}` : base;
      return { symbol: sym, label };
    });
    let rankedOnList: WatchlistAddSuggestion[] = [];
    if (q) {
      rankedOnList = rankSymbolCandidates(onListAsCandidates, q)
        .slice(0, 8)
        .map((c) => ({ ...c, kind: "watchlist" as const }));
    }
    const localFiltered = localAddCandidates.filter((c) => !onListSet.has(c.symbol));
    let rankedAdd: WatchlistAddSuggestion[] = [];
    if (!q) {
      rankedAdd = localFiltered.slice(0, 8).map((c) => ({ ...c, kind: "add" as const }));
    } else {
      const seenSym = new Set<string>(rankedOnList.map((r) => r.symbol));
      const merged: SymbolCandidate[] = [];
      for (const c of [...localFiltered, ...addRemoteCandidates]) {
        const sym = c.symbol.toUpperCase();
        if (seenSym.has(sym) || onListSet.has(sym)) continue;
        seenSym.add(sym);
        merged.push(c);
      }
      rankedAdd = buildRankedSymbolSuggestions(merged, q, 12).map((c) => ({ ...c, kind: "add" as const }));
    }
    return [...rankedOnList, ...rankedAdd];
  }, [
    addDraft,
    addRemoteCandidates,
    localAddCandidates,
    activeSymbolsDeduped,
    snapshotsBySymbol,
    viewMode,
    dualDeskMaturation,
    maturationSwing,
    maturationDay,
    remoteCompanyBySymbol
  ]);

  const isAddCorroborated = useCallback(
    (sym: string) => {
      const u = sym.trim().toUpperCase();
      if (addSuggestionRows.some((r) => r.symbol === u && r.kind === "add")) return true;
      return isWellFormedUsTicker(sym);
    },
    [addSuggestionRows]
  );

  useEffect(() => {
    if (!addSuggestOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = addComboRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) setAddSuggestOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [addSuggestOpen]);

  useEffect(() => {
    setAddSuggestHighlight(0);
  }, [addDraft, addSuggestOpen]);

  useEffect(() => {
    setAddSuggestHighlight((h) =>
      addSuggestionRows.length ? Math.min(h, addSuggestionRows.length - 1) : 0
    );
  }, [addSuggestionRows]);

  async function addSymbol(symOrRaw: string, options?: { skipCorroboration?: boolean }) {
    if (!active) return;
    const raw = symOrRaw.trim();
    const sym = parseTickerInput(raw) || canonicalUsTicker(raw);
    setSymErr(null);
    if (!sym) {
      setSymErr("Enter a valid ticker.");
      return;
    }
    if (!options?.skipCorroboration && !isAddCorroborated(sym)) {
      setSymErr("No matching ticker. Choose from the list or verify the symbol.");
      return;
    }
    const cur = dedupeSymbolsUpper(active.symbols);
    if (cur.includes(sym)) {
      setSymErr("That symbol is already on your watchlist.");
      setAddDraft(sym);
      focusSymbolOnWatchlist(sym);
      return;
    }
    const prev = rows;
    const w0 = rows[0];
    if (!w0) return;
    const optimistic: WatchlistRow[] = [
      w0.watchlist_id === active.watchlist_id ? { ...w0, symbols: [...cur, sym] } : w0
    ];
    setRows(optimistic);
    try {
      const res = await fetch(`/api/stocvest/watchlists/${encodeURIComponent(active.watchlist_id)}/symbols`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: sym })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400) {
        setRows(prev);
        setSymErr((data as { message?: string }).message || "Limit reached");
        return;
      }
      if (!res.ok) {
        setRows(prev);
        // 422 invalid_symbol carries a specific reason ("…not a recognized ticker").
        setSymErr((data as { message?: string }).message || "Add failed");
        return;
      }
      setRows((r) => {
        const z = r[0];
        if (!z || z.watchlist_id !== active.watchlist_id) return r;
        const row = data as WatchlistRow;
        return [{ ...row, symbols: dedupeSymbolsUpper(row.symbols) }];
      });
      setAddDraft("");
      setAddSuggestOpen(false);
      const symU = sym.trim().toUpperCase();
      const trackingMeta = watchlistAttentionSectionMeta("tracking");
      setJustAddedSymbol(symU);
      setForceOpenTiers(["tracking"]);
      setWatchlistToast({
        message: `${symU} added → ${trackingMeta.title} (evaluating…)`,
        symbol: symU
      });
      window.setTimeout(() => focusWatchlistRow(symU, colors.accent), 120);
      if (maturationEligible) {
        setEvaluatingSymbols((prev) => ({
          ...prev,
          [symU]: { swing: true, day: dualDeskMaturation ? true : undefined }
        }));
        void (async () => {
          try {
            await primeWatchlistSymbolMaturation(sym, dualDeskMaturation);
          } finally {
            setEvaluatingSymbols((prev) => {
              const next = { ...prev };
              delete next[symU];
              return next;
            });
            setMaturationReloadNonce((n) => n + 1);
          }
        })();
      }
    } catch {
      setRows(prev);
      setSymErr("Network error");
    }
  }

  const refreshSymbolMaturationDesk = useCallback(
    (sym: string, desk: WatchlistMaturationDesk) => {
      if (!maturationEligible) return;
      const symU = sym.trim().toUpperCase();
      if (!symU) return;
      setEvaluatingSymbols((prev) => ({
        ...prev,
        [symU]: { ...prev[symU], [desk]: true }
      }));
      void (async () => {
        try {
          await refreshWatchlistSymbolMaturationDesk(symU, desk);
        } finally {
          setEvaluatingSymbols((prev) => {
            const next = { ...prev };
            const row = next[symU];
            if (!row) return next;
            const deskRow = { ...row, [desk]: false };
            if (!deskRow.swing && !deskRow.day) {
              delete next[symU];
            } else {
              next[symU] = deskRow;
            }
            return next;
          });
          setMaturationReloadNonce((n) => n + 1);
        }
      })();
    },
    [maturationEligible]
  );

  async function removeSymbol(sym: string) {
    if (!active) return;
    const prev = rows;
    setRows((r) => {
      const z = r[0];
      if (!z || z.watchlist_id !== active.watchlist_id) return r;
      return [{ ...z, symbols: dedupeSymbolsUpper(z.symbols.filter((s) => s.trim().toUpperCase() !== sym)) }];
    });
    try {
      const res = await fetch(
        `/api/stocvest/watchlists/${encodeURIComponent(active.watchlist_id)}/symbols/${encodeURIComponent(sym)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRows(prev);
        setError((data as { message?: string }).message || "Remove failed");
        return;
      }
      setRows((r) => {
        const z = r[0];
        if (!z || z.watchlist_id !== active.watchlist_id) return r;
        const row = data as WatchlistRow;
        return [{ ...row, symbols: dedupeSymbolsUpper(row.symbols) }];
      });
    } catch {
      setRows(prev);
    }
  }

  const maturationDeskSummary = useMemo(() => {
    if (!maturationEligible || activeSymbolsDeduped.length === 0) return null;
    if (maturationFetchStatus === "loading") return "Loading maturation…";
    if (maturationStorageReady === false) {
      return "Maturation storage is not configured on the API — rows cannot persist until ops enables DynamoDB";
    }
    if (maturationFetchStatus === "error") return "Maturation unavailable";
    if (maturationFetchStatus !== "ready") return null;
    return watchlistMaturationDeskSummary(
      activeSymbolsDeduped,
      maturationSwing,
      maturationDay,
      viewMode,
      dualDeskMaturation,
      { sessionClosed }
    );
  }, [
    maturationEligible,
    activeSymbolsDeduped,
    maturationFetchStatus,
    maturationStorageReady,
    maturationSwing,
    maturationDay,
    viewMode,
    dualDeskMaturation,
    sessionClosed
  ]);

  const sortedSymbols = useMemo(() => {
    if (!active) return [];
    const syms = activeSymbolsDeduped;
    if (!maturationEligible || maturationFetchStatus !== "ready") {
      return [...syms].sort();
    }
    return [...syms].sort((a, b) =>
      compareSymbolsByPresentationPriority(
        a,
        b,
        symbolTrackingMap,
        maturationSwing,
        maturationDay,
        dualDeskMaturation
      )
    );
  }, [
    active,
    activeSymbolsDeduped,
    maturationFetchStatus,
    maturationSwing,
    maturationDay,
    symbolTrackingMap,
    dualDeskMaturation
  ]);

  const displaySymbols = useMemo(() => {
    let list = sortedSymbols;
    if (nearReadyFilterActive && maturationFetchStatus === "ready") {
      list = list.filter((sym) => {
        const symU = sym.trim().toUpperCase();
        const ms = maturationSwing[symU];
        const md = maturationDay[symU];
        const row = watchlistMaturationRowForDesk(viewMode, ms, md);
        if (row?.progress_band === "near_ready") return true;
        const aligned = typeof row?.layers_aligned === "number" ? row.layers_aligned : 0;
        return (
          resolveAlignmentDisplayTier({
            layersAligned: aligned,
            layersTotal: row?.layers_total,
            maturationState: row?.state
          }) === "near_ready"
        );
      });
    }
    if (maturationRailFilter && maturationFetchStatus === "ready") {
      list = list.filter((sym) => {
        const symU = sym.trim().toUpperCase();
        const state = displayStateForSymbol(
          symU,
          symbolTrackingMap,
          maturationSwing,
          maturationDay,
          dualDeskMaturation
        );
        return symbolMatchesMaturationRail(state, maturationRailFilter);
      });
    }
    return list;
  }, [
    sortedSymbols,
    nearReadyFilterActive,
    maturationRailFilter,
    maturationFetchStatus,
    maturationSwing,
    maturationDay,
    viewMode,
    symbolTrackingMap,
    dualDeskMaturation
  ]);

  const filteredSymbolsForList = useMemo(() => {
    const q = addDraft.trim();
    if (!q) return displaySymbols;
    return displaySymbols.filter((s) => {
      const symU = s.trim().toUpperCase();
      return watchlistSymbolMatchesSearch(
        symU,
        q,
        viewMode,
        dualDeskMaturation,
        snapshotsBySymbol[symU],
        maturationSwing[symU],
        maturationDay[symU],
        remoteCompanyBySymbol.get(symU)
      );
    });
  }, [
    displaySymbols,
    addDraft,
    viewMode,
    dualDeskMaturation,
    snapshotsBySymbol,
    maturationSwing,
    maturationDay,
    remoteCompanyBySymbol
  ]);

  const maturationRowForSymbol = useCallback(
    (symU: string) => {
      const ms = maturationEligible ? maturationSwing[symU] : undefined;
      const md = maturationEligible && dualDeskMaturation ? maturationDay[symU] : undefined;
      return watchlistMaturationRowForDesk(viewMode, ms, md);
    },
    [maturationEligible, maturationSwing, maturationDay, dualDeskMaturation, viewMode]
  );

  const focusSymbolOnWatchlist = useCallback(
    (sym: string) => {
      const symU = sym.trim().toUpperCase();
      if (!activeSymbolsDeduped.includes(symU)) return;
      const tier = resolveWatchlistAttentionTier(maturationRowForSymbol(symU));
      setForceOpenTiers([tier]);
      window.requestAnimationFrame(() => {
        window.setTimeout(() => focusWatchlistRow(symU, colors.accent), 80);
      });
    },
    [activeSymbolsDeduped, maturationRowForSymbol, colors.accent]
  );

  const handleMaturationRailClick = useCallback(
    (rail: WatchlistMaturationRailKey) => {
      const next = maturationRailFilter === rail ? null : rail;
      setMaturationRailFilter(next);
      if (!next) {
        setForceOpenTiers([]);
        return;
      }
      const matches = sortedSymbols.filter((sym) => {
        const symU = sym.trim().toUpperCase();
        const state = displayStateForSymbol(
          symU,
          symbolTrackingMap,
          maturationSwing,
          maturationDay,
          dualDeskMaturation
        );
        return symbolMatchesMaturationRail(state, next);
      });
      if (matches.length === 0) return;
      const tiers = new Set<WatchlistAttentionTier>();
      for (const sym of matches) {
        const symU = sym.trim().toUpperCase();
        tiers.add(resolveWatchlistAttentionTier(maturationRowForSymbol(symU)));
      }
      setForceOpenTiers([...tiers]);
      const first = matches[0]!.trim().toUpperCase();
      window.requestAnimationFrame(() => {
        window.setTimeout(() => focusWatchlistRow(first, colors.accent), 80);
      });
    },
    [
      maturationRailFilter,
      sortedSymbols,
      symbolTrackingMap,
      maturationSwing,
      maturationDay,
      dualDeskMaturation,
      maturationRowForSymbol,
      colors.accent
    ]
  );

  useEffect(() => {
    const q = addDraft.trim();
    if (!q) return;
    const timer = window.setTimeout(() => {
      let targetSym: string | null = null;
      const parsed = parseTickerInput(q) || canonicalUsTicker(q);
      if (parsed && activeSymbolsDeduped.includes(parsed)) {
        targetSym = parsed;
      } else if (filteredSymbolsForList.length === 1) {
        targetSym = filteredSymbolsForList[0]!.trim().toUpperCase();
      }
      if (!targetSym) return;
      focusSymbolOnWatchlist(targetSym);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [addDraft, filteredSymbolsForList, activeSymbolsDeduped, focusSymbolOnWatchlist]);

  const statusCounts = useMemo(() => {
    const out = {
      actionable: 0,
      developing: 0,
      notAligned: 0,
      invalidated: 0,
      monitored: activeSymbolsDeduped.length
    };
    if (!maturationEligible || maturationFetchStatus !== "ready") return out;
    for (const sym of activeSymbolsDeduped) {
      const disp = (
        displayStateForSymbol(sym, symbolTrackingMap, maturationSwing, maturationDay, dualDeskMaturation) || ""
      ).toLowerCase();
      if (disp === "actionable") out.actionable += 1;
      else if (disp === "developing" || disp === "re_evaluating") out.developing += 1;
      else if (disp === "not_aligned") out.notAligned += 1;
      else if (disp === "invalidated") out.invalidated += 1;
    }
    return out;
  }, [
    active,
    activeSymbolsDeduped,
    maturationFetchStatus,
    maturationSwing,
    maturationDay,
    symbolTrackingMap,
    dualDeskMaturation
  ]);

  const portfolioHeadline = useMemo(
    () => buildWatchlistPortfolioHeadline(statusCounts),
    [statusCounts]
  );

  if (loading) {
    return <CuteLoader label="Loading watchlist" sublabel="Syncing your symbols" compact />;
  }
  if (error && !rows.length) {
    return <p style={{ color: colors.bearish }}>{error}</p>;
  }

  const slotUsed = activeSymbolsDeduped.length;
  const slotsLeft = Math.max(0, maxSymbols - slotUsed);

  const watchlistSearchSection = (
    <section
      className="watchlist-header-search rounded-xl border px-3 py-2"
      data-testid="watchlist-header-search"
      style={{
        background: colors.surface,
        borderColor: colors.border
      }}
    >
      <div ref={addComboRef} className="relative">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <input
                  id="watchlist-add-ticker"
                  role="combobox"
                  aria-expanded={addSuggestOpen}
                  aria-controls="watchlist-add-ticker-suggestions"
                  aria-autocomplete="list"
                  autoComplete="off"
                  value={addDraft}
                  maxLength={80}
                  onChange={(e) => {
                    setAddDraft(e.target.value);
                    setAddSuggestOpen(true);
                    setSymErr(null);
                  }}
                  onFocus={() => setAddSuggestOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setAddSuggestOpen(false), 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setAddSuggestOpen(false);
                      return;
                    }
                    if (e.key === "ArrowDown" && addSuggestionRows.length) {
                      e.preventDefault();
                      setAddSuggestOpen(true);
                      setAddSuggestHighlight((i) => Math.min(i + 1, addSuggestionRows.length - 1));
                      return;
                    }
                    if (e.key === "ArrowUp" && addSuggestionRows.length) {
                      e.preventDefault();
                      setAddSuggestHighlight((i) => Math.max(i - 1, 0));
                      return;
                    }
                    if (e.key === "Enter") {
                      const pick = addSuggestionRows[addSuggestHighlight];
                      if (pick) {
                        e.preventDefault();
                        if (pick.kind === "watchlist") {
                          e.preventDefault();
                          setAddDraft(pick.symbol);
                          setAddSuggestOpen(false);
                          focusSymbolOnWatchlist(pick.symbol);
                          return;
                        }
                        void addSymbol(pick.symbol);
                        return;
                      }
                      const t = parseTickerInput(addDraft.trim()) || canonicalUsTicker(addDraft.trim());
                      if (!t) return;
                      e.preventDefault();
                      void addSymbol(addDraft.trim());
                    }
                  }}
                  placeholder="Search watchlist or add ticker (symbol first, then name)"
                  className="watchlist-search-input min-h-11 w-full flex-1 rounded-lg border px-3 font-mono font-semibold tracking-wide placeholder:font-normal placeholder:font-sans"
                  style={{
                    borderColor:
                      theme === "light" ? "#94a3b8" : "rgba(56, 189, 248, 0.45)",
                    background: theme === "light" ? "#e8eef4" : colors.surface,
                    color: colors.text,
                    boxShadow:
                      theme === "light"
                        ? "inset 0 1px 2px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.04)"
                        : "inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 0 0 1px rgba(56, 189, 248, 0.12)"
                  }}
                />
                <button
                  type="button"
                  className="min-h-11 shrink-0 rounded-lg px-5 text-sm font-bold sm:w-auto"
                  style={{
                    background: colors.accent,
                    color: theme === "light" ? "#ffffff" : "#041018",
                    border: "none",
                    cursor: "pointer"
                  }}
                  onClick={() => {
                    const pick = addSuggestionRows[addSuggestHighlight];
                    if (pick?.kind === "watchlist") {
                      setAddDraft(pick.symbol);
                      setAddSuggestOpen(false);
                      focusSymbolOnWatchlist(pick.symbol);
                      return;
                    }
                    if (pick) void addSymbol(pick.symbol);
                    else void addSymbol(addDraft.trim());
                  }}
                >
                  Add
                </button>
              </div>
              {addSuggestOpen &&
              (addSuggestionRows.length > 0 ||
                (addRemoteSearchLoading && isTickerSearchQueryReady(addDraft)) ||
                (Boolean(addRemoteSearchError) && isTickerSearchQueryReady(addDraft))) ? (
                <ul
                  id="watchlist-add-ticker-suggestions"
                  role="listbox"
                  className={`absolute left-0 right-0 top-full z-[70] mt-1 max-h-60 overflow-y-auto rounded-lg border py-1 shadow-lg sm:right-auto sm:min-w-[min(100%,420px)] ${FLOATING_SURFACE_CLASS}`}
                  style={{
                    background: colors.surface,
                    borderColor: colors.border,
                    boxShadow: "0 12px 40px rgba(0,0,0,0.35)"
                  }}
                >
                  {addRemoteSearchError && isTickerSearchQueryReady(addDraft) ? (
                    <li className="px-3 py-2 text-sm leading-snug" style={{ color: colors.bearish }}>
                      {addRemoteSearchError}
                    </li>
                  ) : null}
                  {addRemoteSearchLoading &&
                  addSuggestionRows.length === 0 &&
                  isTickerSearchQueryReady(addDraft) &&
                  !addRemoteSearchError ? (
                    <li className="px-3 py-2 text-sm" style={{ color: colors.textMuted }}>
                      Searching…
                    </li>
                  ) : null}
                  {addSuggestionRows.map((row, idx) => (
                    <li key={`${row.kind}-${row.symbol}`} role="option" aria-selected={idx === addSuggestHighlight}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm"
                        style={{
                          background: idx === addSuggestHighlight ? "rgba(59,130,246,0.15)" : "transparent",
                          color: colors.text,
                          border: "none",
                          cursor: "pointer"
                        }}
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => {
                          if (row.kind === "watchlist") {
                            setAddDraft(row.symbol);
                            setAddSuggestOpen(false);
                            focusSymbolOnWatchlist(row.symbol);
                            return;
                          }
                          void addSymbol(row.symbol);
                        }}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: colors.textMuted }}>
                          {row.kind === "watchlist" ? "On your list" : "Add"}
                        </span>
                        <span className="mt-0.5 block font-semibold tracking-wide">{row.symbol}</span>
                        {row.label !== row.symbol ? (
                          <span className="block text-xs" style={{ color: colors.textMuted }}>
                            {row.label.includes("—") ? row.label.split("—").slice(1).join("—").trim() : row.label}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                  {!addRemoteSearchLoading &&
                  !addRemoteSearchError &&
                  addSuggestionRows.length === 0 &&
                  isTickerSearchQueryReady(addDraft) ? (
                    <li className="px-3 py-2 text-sm" style={{ color: colors.textMuted }}>
                      No matching tickers. Try a symbol (e.g. AAPL) or another spelling.
                    </li>
                  ) : null}
                </ul>
              ) : null}
              {symErr ? (
                <p className="m-0 pt-1 text-xs" style={{ color: colors.bearish }}>
                  {symErr}
                </p>
              ) : (
                <p className="m-0 pt-1 text-xs leading-snug" style={{ color: colors.textMuted }}>
                  New symbols start in Tracking until evaluated. Search filters the list — pick &quot;On your list&quot;
                  to jump to a card.
                </p>
              )}
      </div>
    </section>
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-col overflow-visible" style={{ gap: spacing[2] }}>
      {active ? (
        <>
          <header
            ref={watchlistHeaderRef}
            className="watchlist-sticky-header app-sticky-page-header sticky z-40 w-full max-w-none self-start pb-2 pt-0"
            style={{ top: watchlistTopBarPx, marginTop: watchlistTopBarPx }}
          >
            {watchlistSearchSection}

            <div className="flex flex-wrap items-start justify-between gap-2 pt-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="m-0 truncate text-xl font-bold tracking-tight sm:text-2xl" style={{ color: colors.text }}>
                    Watchlist
                  </h1>
                  {maturationEligible ? (
                    <WatchlistEvaluationInfoTip desk={viewMode === "day" ? "day" : "swing"} />
                  ) : null}
                </div>
                {maturationEligible ? (
                  <p
                    className="m-0 mt-1 max-w-2xl text-sm font-medium"
                    style={{ color: colors.text }}
                    data-testid="watchlist-portfolio-headline"
                  >
                    {maturationFetchStatus === "ready"
                      ? portfolioHeadline
                      : maturationFetchStatus === "loading"
                        ? "Loading maturation…"
                        : maturationFetchStatus === "error"
                          ? "Maturation unavailable"
                          : "Track symbols for maturation status"}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <span
                  className="rounded-full px-3 py-1 text-xs font-semibold tabular-nums sm:text-sm"
                  style={{
                    background: colors.surfaceMuted,
                    border: `1px solid ${colors.border}`,
                    color: colors.text
                  }}
                >
                  {planBadgeLabel} · {slotUsed}/{maxSymbols}
                </span>
              </div>
            </div>

            <section
              className="watchlist-header-desk mt-2 border-t"
              data-testid="watchlist-header-desk"
              style={{ borderColor: colors.border }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {deskMarketEnvironment ? (
                    <MarketEnvironmentStrip
                      environment={deskMarketEnvironment}
                      testId="watchlist-environment-strip"
                    />
                  ) : null}
                  <DeskModeTabNav
                    value={viewMode}
                    onChange={setViewMode}
                    modes={dualDeskMaturation ? (["swing", "day"] as const) : (["swing"] as const)}
                    ariaLabel="Watchlist desk"
                    testIdPrefix="watchlist-desk"
                    className="min-w-0 flex-1 sm:flex-none"
                  />
                </div>
                {maturationDeskSummary || maturationSummaryFetchedAt ? (
                  <span
                    className="max-w-md shrink-0 text-right text-xs leading-snug sm:text-sm"
                    style={{ color: colors.textMuted }}
                    data-testid="watchlist-maturation-desk-summary"
                  >
                    {maturationDeskSummary}
                    {maturationSummaryFetchedAt && maturationFetchStatus === "ready" ? (
                      <>
                        {maturationDeskSummary ? " · " : null}
                        <span data-testid="watchlist-summary-fetched-at">
                          Fetched {formatSummaryFetchedAt(maturationSummaryFetchedAt)}
                        </span>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </section>
          </header>

          <div style={{ display: "grid", gap: spacing[3] }}>
            {maturationEligible && activeSymbolsDeduped.length > 0 && maturationFetchStatus === "error" ? (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: colors.border, background: colors.surface }}
                data-testid="watchlist-maturation-error"
                role="alert"
              >
                <p className="m-0" style={{ color: colors.text }}>
                  Maturation status couldn&apos;t load. Symbols and quotes are still shown.
                </p>
                <button
                  type="button"
                  className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold"
                  style={{ borderColor: colors.border, color: colors.text }}
                  onClick={() => setMaturationReloadNonce((n) => n + 1)}
                >
                  Retry
                </button>
              </div>
            ) : null}
            {nearReadyFilterActive ? (
              <div
                data-testid="watchlist-near-ready-filter-banner"
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: colors.border, background: colors.surface }}
              >
                <p className="m-0" style={{ color: colors.text }}>
                  Showing symbols at <strong>near ready</strong> (4/6 layers) for this desk.{" "}
                  <Link href={pathname} prefetch={false} className="font-semibold" style={{ color: colors.accent }}>
                    Show all
                  </Link>
                </p>
              </div>
            ) : null}
            {maturationEligible && activeSymbolsDeduped.length > 0 && maturationFetchStatus === "ready" ? (
              <div className="watchlist-hero">
                <WatchlistStatusRails
                  counts={statusCounts}
                  activeRail={maturationRailFilter}
                  onRailClick={handleMaturationRailClick}
                />
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <WatchlistSortControl
                    value={sortMode}
                    onChange={handleSortModeChange}
                    disabled={maturationFetchStatus !== "ready"}
                  />
                  <WatchlistTrackingDensityToggle
                    checked={trackingCompact}
                    onChange={handleTrackingCompactChange}
                    disabled={maturationFetchStatus !== "ready"}
                  />
                </div>
                <WatchlistOrderExplainer sortMode={sortMode} />
                <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
                  {slotUsed} of {maxSymbols} slots · {slotsLeft} left · grouped by alignment, then sorted within each
                  section — click a card for Signals
                </p>
              </div>
            ) : null}
            
            <article
              className={surfaceGlowClassName}
              style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl }}
            >
                            {maturationEligible && activeSymbolsDeduped.length > 0 ? (
                <div className="mx-4 mt-3">
                  <WatchlistActivityCollapsible
                    alerts={maturationAlerts}
                    status={maturationAlertsStatus}
                    signalsMode={tradingModeForSignalsNav(viewMode, dualDeskMaturation)}
                  />
                </div>
              ) : null}

              <div className="p-3 sm:p-4">
                {activeSymbolsDeduped.length === 0 ? (
                  <div>
                    <p className="m-0 mb-3 text-sm" style={{ color: colors.textMuted }}>
                      No symbols yet. Use the bar above or tap a popular name.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {QUICK.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void addSymbol(s, { skipCorroboration: true })}
                          className="min-h-10 rounded-md border px-3 text-sm font-bold tracking-wide"
                          style={{ borderColor: colors.accent, color: colors.text }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {maturationRailFilter &&
                    activeSymbolsDeduped.length > 0 &&
                    filteredSymbolsForList.length > 0 &&
                    filteredSymbolsForList.length < sortedSymbols.length ? (
                      <p
                        className="m-0 mb-3 text-sm"
                        style={{ color: colors.textMuted }}
                        data-testid="watchlist-maturation-rail-filter-banner"
                      >
                        Showing {filteredSymbolsForList.length} of {sortedSymbols.length} symbols in{" "}
                        <strong>{WATCHLIST_MATURATION_RAIL_LABELS[maturationRailFilter]}</strong>.{" "}
                        <button
                          type="button"
                          className="font-semibold underline-offset-2 hover:underline"
                          style={{ color: colors.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                          onClick={() => {
                            setMaturationRailFilter(null);
                            setForceOpenTiers([]);
                          }}
                        >
                          Clear filter
                        </button>
                      </p>
                    ) : null}
                    {activeSymbolsDeduped.length > 0 &&
                    addDraft.trim() &&
                    filteredSymbolsForList.length > 0 &&
                    filteredSymbolsForList.length < displaySymbols.length ? (
                      <p
                        className="m-0 mb-3 text-sm"
                        style={{ color: colors.textMuted }}
                        data-testid="watchlist-filter-banner"
                      >
                        Showing {filteredSymbolsForList.length} of {displaySymbols.length} symbols matching &quot;
                        {addDraft.trim()}&quot;.{" "}
                        <button
                          type="button"
                          className="font-semibold underline-offset-2 hover:underline"
                          style={{ color: colors.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                          onClick={() => setAddDraft("")}
                        >
                          Clear filter
                        </button>
                      </p>
                    ) : null}
                    {activeSymbolsDeduped.length > 0 && addDraft.trim() && filteredSymbolsForList.length === 0 ? (
                      <p className="m-0 mb-3 text-sm" style={{ color: colors.textMuted }}>
                        No symbols match &quot;{addDraft.trim()}&quot; on the {viewMode} desk (symbol, company, and
                        maturation text). Clear
                        the bar to see all rows, or pick &quot;Add&quot; below to add a new ticker.
                      </p>
                    ) : null}
                    {(() => {
                      const planMode = tradingModeForSignalsNav(viewMode, dualDeskMaturation);
                      const symbols = filteredSymbolsForList.map((s) => s.trim().toUpperCase());
                      return (
                        <WatchlistDecisionQueue
                          symbols={symbols}
                          planMode={planMode}
                          rowForSymbol={(symU) => {
                            const ms = maturationEligible ? maturationSwing[symU] : undefined;
                            const md =
                              maturationEligible && dualDeskMaturation ? maturationDay[symU] : undefined;
                            return watchlistMaturationRowForDesk(viewMode, ms, md);
                          }}
                          snapshotForSymbol={(symU) => snapshotsBySymbol[symU]}
                          deskEvaluatingForSymbol={(symU) => evaluatingSymbols[symU]?.[planMode]}
                          showDeskCompare={dualDeskMaturation}
                          onCompareDesks={
                            dualDeskMaturation ? (symU) => setCompareSheetSymbol(symU) : undefined
                          }
                          onRemove={(symU) => void removeSymbol(symU)}
                          onRefresh={
                            maturationEligible
                              ? (symU) => refreshSymbolMaturationDesk(symU, planMode)
                              : undefined
                          }
                          forceOpenTiers={forceOpenTiers}
                          justAddedSymbol={justAddedSymbol}
                          sortMode={sortMode}
                          trackingCompact={trackingCompact}
                          desk={watchlistDesk}
                        />
                      );
                    })()}
                  </>
                )}
              </div>
            </article>

            <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
              Your watchlist is a prioritized queue — click a card for Signals. Strong means layer alignment on your
              list; held lines mean the market is quiet or bearish, so timing may wait even when structure looks good.
              Use Refresh for the
              active desk
              {dualDeskMaturation ? "; Compare desks opens swing vs day for that symbol" : ""}.
              <Link href="/dashboard" prefetch={false} className="ml-1 font-semibold" style={{ color: colors.accent }}>
                Open Signals
              </Link>
            </p>
          </div>
        </>
      ) : (
        <p style={{ color: colors.textMuted }}>Could not load your watchlist.</p>
      )}
      <WatchlistAlignmentSheet
        open={alignmentSheet != null}
        symbol={alignmentSheet?.symbol ?? ""}
        deskMode={alignmentSheet?.deskMode ?? "swing"}
        row={alignmentSheetRow}
        onClose={() => setAlignmentSheet(null)}
      />
      {dualDeskMaturation ? (
        <WatchlistDeskCompareSheet
          open={compareSheetSymbol != null}
          symbol={compareSheetSymbol ?? ""}
          swingRow={
            compareSheetSymbol ? maturationSwing[compareSheetSymbol.trim().toUpperCase()] : undefined
          }
          dayRow={compareSheetSymbol ? maturationDay[compareSheetSymbol.trim().toUpperCase()] : undefined}
          swingEvaluating={
            compareSheetSymbol
              ? evaluatingSymbols[compareSheetSymbol.trim().toUpperCase()]?.swing
              : undefined
          }
          dayEvaluating={
            compareSheetSymbol
              ? evaluatingSymbols[compareSheetSymbol.trim().toUpperCase()]?.day
              : undefined
          }
          onClose={() => setCompareSheetSymbol(null)}
          onRefreshDesk={(desk) => {
            if (!compareSheetSymbol) return;
            void refreshSymbolMaturationDesk(compareSheetSymbol, desk);
          }}
          onOpenAlignment={(desk) => {
            if (!compareSheetSymbol) return;
            const symU = compareSheetSymbol.trim().toUpperCase();
            setCompareSheetSymbol(null);
            setAlignmentSheet({ symbol: symU, deskMode: desk });
          }}
        />
      ) : null}
      {watchlistToast && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed bottom-6 left-1/2 z-50 flex max-w-md -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg"
              style={{
                background: colors.surface,
                borderColor: colors.border,
                color: colors.text,
                boxShadow: "0 16px 48px rgba(0,0,0,0.35)"
              }}
              role="status"
              data-testid="watchlist-toast"
            >
              <span>{watchlistToast.message}</span>
              <button
                type="button"
                className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold"
                style={{ borderColor: colors.accent, color: colors.accent, background: "transparent", cursor: "pointer" }}
                onClick={() => focusSymbolOnWatchlist(watchlistToast.symbol)}
              >
                View
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
