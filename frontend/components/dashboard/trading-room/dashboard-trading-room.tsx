"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PanelLeftClose } from "lucide-react";
import { mutate as mutateSwr } from "swr";
import { usePathname, useSearchParams } from "next/navigation";
import { AppSessionHeader } from "@/components/app-session-header";
import { useTheme } from "@/lib/theme-provider";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import {
  ScannerOverviewProvider,
  useScannerOverview
} from "@/components/dashboard/scanner-overview-context";
import {
  DashboardEarningsProvider,
  useDashboardEarnings
} from "@/components/dashboard/dashboard-earnings-context";
import { useDeskToday } from "@/lib/hooks/use-desk-today";
import { useTradingRoomDeskAutoLoad } from "@/lib/hooks/use-trading-room-desk-auto-load";
import { useTradingRoomMaturation } from "@/lib/hooks/use-trading-room-maturation";
import { isDeskCacheStale } from "@/lib/dashboard/desk-response";
import { __internal_fetchSignalComposite } from "@/lib/hooks/use-signal-composite";
import { signalCompositeCacheKey } from "@/lib/signal-composite-cache";
import type { DeskTodayData } from "@/lib/api/desk-today";
import { formatTradingDateLabel, isoDateInNewYork } from "@/lib/market-hours-et";
import { useMacroContext } from "@/lib/hooks/use-macro-context";
import { useMarketNews } from "@/lib/hooks/use-market-news";
import { useMarketBriefNarrative } from "@/lib/hooks/use-market-brief-narrative";
import { useStackedLayout } from "@/lib/hooks/use-stacked-layout";
import { PAGE_STACK_MAX_PX } from "@/lib/layout-breakpoints";
import { marketStatusLabelFor, resolveSessionRegimeLabel, snapPct } from "@/lib/session-header-market";
import { isRegularSessionOpen } from "@/lib/market/regular-session";
import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import type {
  DashboardDeskInitial,
  DashboardSectorRotationRow
} from "@/lib/dashboard/dashboard-page-data";
import {
  MarketBrief,
  type BriefHeadline,
  type BriefMover,
  type BriefOutcomesRecap,
  type BriefSector,
  type BriefWeekEvent,
  type BriefWeekInReview,
  type MarketBriefData
} from "@/components/dashboard/trading-room/market-brief";
import {
  isPreparationPhase,
  resolveBriefSessionPhase
} from "@/lib/dashboard/trading-room/brief-session-copy";
import { useDashboardTape } from "@/lib/hooks/use-dashboard-tape";
import { useWatchlistAtClose } from "@/lib/hooks/use-watchlist-at-close";
import { useWeeklySetupOutcomes } from "@/lib/hooks/use-weekly-setup-outcomes";
import { DeepDive } from "@/components/dashboard/trading-room/deep-dive";
import { QuietFeed } from "@/components/dashboard/trading-room/quiet-feed";
import { TradingRoomMountRefresh } from "@/components/dashboard/trading-room/trading-room-mount-refresh";
import { TradingRoomPeriodicRefresh } from "@/components/dashboard/trading-room/trading-room-periodic-refresh";
import {
  CardRefreshButton,
  FeedCardUpdatedLine,
  laneBadgeStyle
} from "@/lib/dashboard/trading-room/feed-card-present";
import {
  refreshTradingRoomCard,
  TRADING_ROOM_DATA_REFRESH_EVENT
} from "@/lib/dashboard/trading-room/trading-room-card-refresh";
import { feedBiasColor } from "@/lib/signal-direction-colors";
import { overlayFeedCardTimestamps } from "@/lib/dashboard/trading-room/feed-card-timestamps";
import { useSymbolNames } from "@/lib/hooks/use-symbol-names";
import { WatchlistRail } from "@/components/dashboard/trading-room/watchlist-rail";
import { MarketEnvironmentStrip } from "@/components/market-environment-strip";
import { useMarketEnvironment } from "@/lib/hooks/use-market-environment";
import { environmentSessionCardHint } from "@/lib/signal-evidence/environment-session-hint";
import type { MarketEnvironmentPayload } from "@/lib/signal-evidence/market-environment-present";
import {
  consumeTradingRoomPostLoginFresh,
  getLastSelectedId,
  isFirstVisitOfTradingDay,
  recordTradingRoomVisit,
  setLastSelectedId
} from "@/lib/dashboard/trading-room/session-selection";
import {
  applyDashboardSymbolUrl,
  clearTradingRoomOpenIntent,
  feedCardIdForDeepLink,
  parseDashboardTradingRoomDeepLink,
  peekTradingRoomOpenIntent,
  syntheticFeedCardForDeepLink,
  type DashboardTradingRoomDeepLink
} from "@/lib/nav/dashboard-trading-room-deeplink";
import {
  buildFeedCards,
  groupFeedByLane,
  rankAndCapFeed,
  type FeedBias,
  type FeedCard,
  type FeedFilters,
  type FeedLane,
  type FeedState,
  DEFAULT_FEED_FILTERS
} from "@/lib/dashboard/trading-room/feed-model";
import { feedCardStateLabel } from "@/lib/dashboard/trading-room/feed-state-present";
import { useTrackedPlansList } from "@/lib/hooks/use-tracked-plans-list";
import { feedCardTrackedPlanKey } from "@/lib/trade-plan/tracked-plan-key";
import { TrackedPlanBadge } from "@/components/trade-plan/tracked-plan-badge";
import { TrackedPlansAlertStrip } from "@/components/trade-plan/tracked-plans-alert-strip";

export interface DashboardTradingRoomProps {
  marketOverview: MarketOverview;
  scannerOverview: ScannerOverview;
  earningsEvents: EarningsEvent[];
  earningsRecent: EarningsEvent[];
  dayTradingSurfaces?: boolean;
  deskInitial?: DashboardDeskInitial;
  /** Server-computed sector ETF rotation (1-day + 5-day) for the brief. */
  sectorRotation?: DashboardSectorRotationRow[];
  /** First name for the brief greeting; falls back to a name-less greeting. */
  userName?: string | null;
  /** Renders null; hydrates the scanner overview context with live setups/gaps. */
  deferredScannerSlot?: ReactNode;
  /** Symbol handoff from `?symbol=` / scanner intent — seeds Deep Dive on first paint. */
  openIntent?: DashboardTradingRoomDeepLink | null;
}

function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function mapNewsSentiment(s: string | null | undefined): "bullish" | "bearish" | "neutral" {
  const v = (s || "").trim().toLowerCase();
  if (v === "positive" || v === "bullish") return "bullish";
  if (v === "negative" || v === "bearish") return "bearish";
  return "neutral";
}

function newsAgeLabel(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/** Human "when" for a macro event row, e.g. "Tue 8:30 AM ET" — falls back to a day count. */
function formatEventWhen(scheduledIso: string | null | undefined, hoursUntil: number): string {
  if (scheduledIso?.trim()) {
    const d = new Date(scheduledIso);
    if (Number.isFinite(d.getTime())) {
      return (
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        }).format(d) + " ET"
      );
    }
  }
  const days = Math.round(hoursUntil / 24);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days}d`;
}

/** Swing-lane accent (violet/magenta) — deliberately far from the day/interactive blue. */
const SWING_ACCENT = "#c04cf5";

/** Plain-English read on the tape from index moves + sector tilt + VIX. Null when no index data. */
function buildSessionNarrative({
  marketOpen,
  spyPct,
  qqqPct,
  iwmPct,
  vixLevel,
  vixPct,
  sectors
}: {
  marketOpen: boolean | null;
  spyPct: number | null;
  qqqPct: number | null;
  iwmPct: number | null;
  vixLevel: number | null;
  vixPct: number | null;
  sectors: { label: string; pct: number }[];
}): string | null {
  if (spyPct == null) return null;
  const verb = marketOpen === false ? "finished" : "is trading";
  const tone = spyPct > 0.15 ? "higher" : spyPct < -0.15 ? "lower" : "little changed";
  const lead = `The S&P 500 ${verb} ${tone} (${fmtPct(spyPct)})`;

  const clauses: string[] = [];
  if (qqqPct != null) {
    if (qqqPct - spyPct > 0.4) clauses.push("tech outperforming");
    else if (spyPct - qqqPct > 0.4) clauses.push("tech dragging");
  }
  if (iwmPct != null) {
    if (iwmPct - spyPct > 0.4) clauses.push("small caps leading (risk-on)");
    else if (spyPct - iwmPct > 0.4) clauses.push("small caps lagging (defensive)");
  }

  let vixClause = "";
  if (vixLevel != null) {
    const fear = vixPct != null && vixPct > 5 ? ", fear rising" : "";
    if (vixLevel >= 20) vixClause = ` Volatility is elevated (VIX ${vixLevel.toFixed(1)}${fear}).`;
    else if (vixLevel < 14) vixClause = ` Volatility is subdued (VIX ${vixLevel.toFixed(1)}).`;
    else vixClause = ` Volatility is moderate (VIX ${vixLevel.toFixed(1)}${fear}).`;
  }

  // Sector tilt: best vs worst of the tracked sector ETFs.
  let sectorClause = "";
  if (sectors.length >= 2) {
    const best = sectors[0];
    const worst = sectors[sectors.length - 1];
    if (best.pct > 0.1 || worst.pct < -0.1) {
      sectorClause = ` ${best.label} leads (${fmtPct(best.pct)}) while ${worst.label} lags (${fmtPct(worst.pct)}).`;
    }
  }

  const body = clauses.length > 0 ? `${lead}, with ${joinClauses(clauses)}.` : `${lead}.`;
  return `${body}${sectorClause}${vixClause}`;
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export function DashboardTradingRoom(props: DashboardTradingRoomProps) {
  return (
    <ScannerOverviewProvider initialOverview={props.scannerOverview}>
      <DashboardEarningsProvider
        initialUpcoming={props.earningsEvents}
        initialRecent={props.earningsRecent}
      >
        <TradingRoomBody {...props} />
        {props.deferredScannerSlot}
      </DashboardEarningsProvider>
    </ScannerOverviewProvider>
  );
}

function TradingRoomBody({
  marketOverview,
  dayTradingSurfaces = true,
  deskInitial,
  sectorRotation = [],
  userName,
  openIntent = null
}: DashboardTradingRoomProps) {
  const { colors } = useTheme();
  const pathname = usePathname();
  const isMobile = useStackedLayout(PAGE_STACK_MAX_PX);
  const scannerOverview = useScannerOverview();
  const earnings = useDashboardEarnings();
  const { data: macro } = useMacroContext();
  const { articles: newsArticles } = useMarketNews();
  const { data: aiBrief } = useMarketBriefNarrative();
  const swingEnvironment = useMarketEnvironment("swing", { macroRegime: macro?.market_regime });
  const dayEnvironment = useMarketEnvironment("day", { macroRegime: macro?.market_regime });
  const { plans: trackedPlans } = useTrackedPlansList();
  const trackedPlanKeys = useMemo(
    () =>
      new Set(trackedPlans.map((p) => feedCardTrackedPlanKey({ symbol: p.symbol, lane: p.mode }))),
    [trackedPlans]
  );

  const { data: swingDesk, mutate: refreshSwingDesk } = useDeskToday("swing", { fallbackData: deskInitial?.swing });
  const { data: dayDesk, mutate: refreshDayDesk } = useDeskToday("day", {
    fallbackData: deskInitial?.day
  });

  const scannerDataSettled = useMemo(
    () =>
      Boolean(scannerOverview.error) ||
      scannerOverview.swingUniverseSymbolCount != null ||
      scannerOverview.gapIntelligence.length > 0 ||
      scannerOverview.setups.length > 0,
    [
      scannerOverview.error,
      scannerOverview.swingUniverseSymbolCount,
      scannerOverview.gapIntelligence.length,
      scannerOverview.setups.length
    ]
  );

  const { deskWarmupLoading } = useTradingRoomDeskAutoLoad({
    dayTradingSurfaces,
    swingDesk,
    dayDesk,
    scannerDataSettled,
    gapFallbackCount: scannerOverview.gapIntelligence.length,
    revalidateSwingDesk: refreshSwingDesk,
    revalidateDayDesk: refreshDayDesk
  });

  const [snapshotOverrides, setSnapshotOverrides] = useState<Map<string, SnapshotPayload>>(new Map());
  const [refreshingCardIds, setRefreshingCardIds] = useState<Set<string>>(() => new Set());
  const [centerDataRefreshNonce, setCenterDataRefreshNonce] = useState(0);

  const { snapshotsBySymbol: tapeSnapshots, status: marketStatus } = useDashboardTape(marketOverview);
  const snapshotsBySymbol = useMemo(() => {
    if (snapshotOverrides.size === 0) return tapeSnapshots;
    const merged = new Map(tapeSnapshots);
    for (const [sym, snap] of snapshotOverrides) merged.set(sym, snap);
    return merged;
  }, [tapeSnapshots, snapshotOverrides]);

  const { swingSetups, daySetups } = useMemo(() => {
    const swing = scannerOverview.setups.filter((s) => s.scanner_mode === "swing_daily");
    const day = scannerOverview.setups.filter(
      (s) => s.scanner_mode !== "swing_daily" && typeof s.score === "number" && Number.isFinite(s.score)
    );
    return { swingSetups: swing, daySetups: day };
  }, [scannerOverview.setups]);

  const companyBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of scannerOverview.setups) {
      const sym = s.symbol?.trim().toUpperCase();
      if (sym && s.company_name?.trim()) map.set(sym, s.company_name.trim());
    }
    for (const g of scannerOverview.gapIntelligence) {
      const sym = g.symbol?.trim().toUpperCase();
      if (sym && g.company_name?.trim() && !map.has(sym)) map.set(sym, g.company_name.trim());
    }
    // Snapshots carry company_name from Polygon — fills in any symbol not
    // covered by the scanner overview (desk-only leaders, watchlist entries).
    for (const [sym, snap] of snapshotsBySymbol) {
      if (snap.company_name?.trim() && !map.has(sym)) map.set(sym, snap.company_name.trim());
    }
    return map;
  }, [scannerOverview.setups, scannerOverview.gapIntelligence, snapshotsBySymbol]);

  const { swingBySymbol, dayBySymbol } = useTradingRoomMaturation(dayTradingSurfaces);

  const allCards = useMemo(() => {
    const cards = buildFeedCards({
      mode: "swing",
      swingDesk: swingDesk?.data,
      dayDesk: dayDesk?.data,
      swingSetups,
      daySetups,
      snapshotsBySymbol,
      dayTradingSurfaces,
      companyBySymbol
    });
    // Safety net: ensure company names are set (fallback to pre-resolved map)
    const withCompany = cards.map((c) => ({
      ...c,
      company: c.company ?? companyBySymbol.get(c.symbol) ?? null
    }));
    return overlayFeedCardTimestamps(withCompany, {
      swingBySymbol,
      dayBySymbol,
      swingDeskGeneratedAt: swingDesk?.data?.generated_at ?? null,
      dayDeskGeneratedAt: dayDesk?.data?.generated_at ?? null
    });
  }, [
    swingDesk?.data,
    dayDesk?.data,
    swingSetups,
    daySetups,
    snapshotsBySymbol,
    dayTradingSurfaces,
    companyBySymbol,
    swingBySymbol,
    dayBySymbol
  ]);

  const [filters, setFilters] = useState<FeedFilters>(DEFAULT_FEED_FILTERS);
  const feedEnvironment = filters.lane === "day" ? dayEnvironment : swingEnvironment;
  const sidebarRefreshSymbols = useMemo(
    () => [...new Set(allCards.map((c) => c.symbol.trim().toUpperCase()).filter(Boolean))],
    [allCards]
  );
  const feedSymbolNames = useSymbolNames(sidebarRefreshSymbols);
  const resolvedCompanyBySymbol = useMemo(() => {
    const map = new Map(companyBySymbol);
    for (const sym of sidebarRefreshSymbols) {
      const nm = feedSymbolNames[sym]?.trim();
      if (nm && !map.has(sym)) map.set(sym, nm);
    }
    return map;
  }, [companyBySymbol, feedSymbolNames, sidebarRefreshSymbols]);
  const cardsWithNames = useMemo(
    () =>
      allCards.map((c) => ({
        ...c,
        company: c.company ?? resolvedCompanyBySymbol.get(c.symbol) ?? null
      })),
    [allCards, resolvedCompanyBySymbol]
  );
  const ranked = useMemo(() => rankAndCapFeed(cardsWithNames, filters), [cardsWithNames, filters]);
  const { day, swing } = useMemo(() => groupFeedByLane(ranked), [ranked]);

  // Feed symbols (movers, setups) are not on the index tape — hydrate quotes in batch.
  const feedSymbolsKey = sidebarRefreshSymbols.join(",");
  useEffect(() => {
    if (sidebarRefreshSymbols.length === 0) return;
    let cancelled = false;
    const chunk = sidebarRefreshSymbols.slice(0, 40);
    void (async () => {
      try {
        const res = await fetch(
          `/api/stocvest/market/snapshots?symbols=${encodeURIComponent(chunk.join(","))}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
        const rows = Array.isArray(json.snapshots) ? json.snapshots : [];
        if (cancelled) return;
        setSnapshotOverrides((prev) => {
          const next = new Map(prev);
          for (const row of rows) {
            const sym = (row.symbol || "").trim().toUpperCase();
            if (sym) next.set(sym, row);
          }
          return next;
        });
      } catch {
        /* quotes are best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feedSymbolsKey, sidebarRefreshSymbols]);

  // Staleness detection: compare the swing desk envelope's market_date against today's ET
  // calendar date. When the app is running on a weekend, the swing desk may have data
  // from Friday (4-day TTL); we surface this transparently rather than hiding it.
  const etToday = isoDateInNewYork();
  const swingDeskDate = typeof swingDesk?.envelope?.market_date === "string"
    ? (swingDesk.envelope.market_date as string)
    : null;
  const swingDataIsStale = swingDeskDate != null && swingDeskDate !== etToday;
  // e.g. "Fri Jun 6" — used in the section header and per-card labels.
  const staleDateLabel: string | null = swingDataIsStale
    ? formatTradingDateLabel(swingDeskDate!)
    : null;

  const [selectedId, setSelectedId] = useState<string | null>(() => openIntent?.key ?? null);
  const selectionBootstrappedRef = useRef(false);
  const prevSelectedIdRef = useRef<string | null>(selectedId);
  // Holds a synthetic card for symbols that live only on the watchlist (not in
  // the desk/scanner feed), so the deep dive can open for any monitored symbol.
  const [overrideCard, setOverrideCard] = useState<FeedCard | null>(() =>
    openIntent ? syntheticFeedCardForDeepLink(openIntent) : null
  );
  // Collapsed by default on every breakpoint — the watchlist is a peek-on-demand
  // rail, not a persistent third column. The user opens it from the collapsed tab.
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  /** Mobile: desk feed collapses while deep-dive is open; expands on session brief. */
  const [feedOpen, setFeedOpen] = useState(true);

  const toggleFeedOpen = useCallback(() => {
    setFeedOpen((open) => {
      const next = !open;
      if (isMobile && next) setWatchlistOpen(false);
      return next;
    });
  }, [isMobile]);

  const toggleWatchlistOpen = useCallback(() => {
    setWatchlistOpen((open) => {
      const next = !open;
      if (isMobile && next) setFeedOpen(false);
      return next;
    });
  }, [isMobile]);

  const searchParams = useSearchParams();

  const syncSymbolInUrl = (card: FeedCard | null) => {
    applyDashboardSymbolUrl(card, pathname || "/dashboard", searchParams.toString());
  };

  const selectCard = (card: FeedCard) => {
    setSelectedId(card.id);
    setOverrideCard(card);
    setLastSelectedId(card.id);
    syncSymbolInUrl(card);
  };
  const select = (id: string | null) => {
    if (!id) {
      setSelectedId(null);
      setOverrideCard(null);
      setLastSelectedId(null);
      syncSymbolInUrl(null);
      return;
    }
    const card = allCards.find((c) => c.id === id);
    if (card) {
      selectCard(card);
      return;
    }
    setSelectedId(id);
    setOverrideCard(null);
    setLastSelectedId(id);
    const colon = id.indexOf(":");
    if (colon > 0) {
      const lane = (id.slice(0, colon) === "day" ? "day" : "swing") as FeedLane;
      const sym = id.slice(colon + 1).trim().toUpperCase();
      if (sym) {
        syncSymbolInUrl(syntheticFeedCardForDeepLink({ symbol: sym, lane, key: id }));
      }
    }
  };
  // Open any searched symbol in the deep dive: reuse the richer feed card when
  // the symbol is already on the desk; otherwise synthesize a minimal card and
  // let the deep dive's composite fetch fill in the read.
  const openSymbol = (symbol: string, company?: string | null, lane: FeedLane = "swing") => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    const existing =
      allCards.find((c) => c.symbol === sym && c.lane === lane) ?? allCards.find((c) => c.symbol === sym);
    if (existing) {
      selectCard(existing);
      return;
    }
    const snap = snapshotsBySymbol.get(sym);
    const last = snap?.last_trade_price;
    selectCard({
      id: feedCardIdForDeepLink(sym, lane),
      symbol: sym,
      company: company?.trim() || companyBySymbol.get(sym) || snap?.company_name?.trim() || null,
      lane,
      state: "potential",
      bias: "neutral",
      verdict: "Looked up from search — full read below.",
      phase: null,
      price: typeof last === "number" && Number.isFinite(last) ? last : null,
      changePct: snapPct(snap),
      alignment: null,
      rankScore: 0,
      source: "desk",
      setupTier: "setup",
      lastEvaluatedAt: null
    });
  };
  const selected = useMemo(() => {
    if (!selectedId) return null;
    const fromFeed = cardsWithNames.find((c) => c.id === selectedId);
    if (fromFeed) return fromFeed;
    if (overrideCard && overrideCard.id === selectedId) return overrideCard;
    return null;
  }, [cardsWithNames, selectedId, overrideCard]);

  useEffect(() => {
    if (!isMobile) return;
    const had = prevSelectedIdRef.current;
    prevSelectedIdRef.current = selectedId;
    if (!had && selectedId) setFeedOpen(false);
    if (had && !selectedId) setFeedOpen(true);
  }, [isMobile, selectedId]);

  useEffect(() => {
    if (!selected) return;
    const sym = selected.symbol.trim().toUpperCase();
    if (!sym) return;
    const lane = selected.lane === "day" ? "day" : "swing";
    const key = signalCompositeCacheKey(sym, lane);
    if (key) {
      void mutateSwr(key, () => __internal_fetchSignalComposite(sym, lane), { revalidate: false });
    }
  }, [selected?.id, selected?.symbol, selected?.lane]);

  const handleRefreshFeedCard = useCallback(
    async (card: FeedCard) => {
      const cardId = card.id;
      setRefreshingCardIds((prev) => new Set(prev).add(cardId));
      try {
        const isSelected = selectedId === cardId;
        const { snapshot } = await refreshTradingRoomCard(card.symbol, card.lane, {
          refreshBothLanes: isSelected
        });
        void refreshSwingDesk();
        void refreshDayDesk();
        if (snapshot?.symbol) {
          const sym = snapshot.symbol.trim().toUpperCase();
          setSnapshotOverrides((prev) => new Map(prev).set(sym, snapshot));
        }
        if (isSelected) setCenterDataRefreshNonce((n) => n + 1);
      } finally {
        setRefreshingCardIds((prev) => {
          const next = new Set(prev);
          next.delete(cardId);
          return next;
        });
      }
    },
    [refreshSwingDesk, refreshDayDesk, selectedId]
  );

  useEffect(() => {
    const onDataRefresh = () => setCenterDataRefreshNonce((n) => n + 1);
    window.addEventListener(TRADING_ROOM_DATA_REFRESH_EVENT, onDataRefresh);
    return () => window.removeEventListener(TRADING_ROOM_DATA_REFRESH_EVENT, onDataRefresh);
  }, []);

  const resetToMarketBrief = () => {
    setLastSelectedId(null);
    clearTradingRoomOpenIntent();
    setSelectedId(null);
    setOverrideCard(null);
    syncSymbolInUrl(null);
    recordTradingRoomVisit();
    selectionBootstrappedRef.current = true;
  };

  const applyDeepLinkOrRestoreSelection = () => {
    const pendingHandoff = peekTradingRoomOpenIntent();
    const freshTradingDay = !pendingHandoff && isFirstVisitOfTradingDay();
    const freshAfterLogin = !pendingHandoff && consumeTradingRoomPostLoginFresh();

    // First open each NY day, or first dashboard load after logout → login, lands
    // on Market Brief — even when a symbol is still in the URL or sessionStorage.
    if (freshTradingDay || freshAfterLogin) {
      resetToMarketBrief();
      return;
    }

    // Card clicks update the URL via `replaceState`, which does not refresh
    // `useSearchParams`. When the user already has a selection, keep it and heal
    // the address bar — never stomp a fresh click with stale hook params.
    if (selectedId && selected) {
      syncSymbolInUrl(selected);
      clearTradingRoomOpenIntent();
      recordTradingRoomVisit();
      selectionBootstrappedRef.current = true;
      return;
    }

    if (pendingHandoff) {
      openSymbol(pendingHandoff.symbol, null, pendingHandoff.lane);
      clearTradingRoomOpenIntent();
      recordTradingRoomVisit();
      selectionBootstrappedRef.current = true;
      return;
    }

    if (selectionBootstrappedRef.current) return;
    selectionBootstrappedRef.current = true;
    recordTradingRoomVisit();

    // Hard refresh: `replaceState` query params survive reload — reopen that setup.
    const urlIntent =
      typeof window !== "undefined"
        ? parseDashboardTradingRoomDeepLink(new URLSearchParams(window.location.search))
        : null;
    if (urlIntent) {
      openSymbol(urlIntent.symbol, null, urlIntent.lane);
      return;
    }

    const lastId = getLastSelectedId();
    if (!lastId) return;
    const existing = allCards.find((c) => c.id === lastId);
    if (existing) {
      selectCard(existing);
      return;
    }
    const colon = lastId.indexOf(":");
    if (colon <= 0) return;
    const lane = lastId.slice(0, colon) === "day" ? "day" : "swing";
    const sym = lastId.slice(colon + 1).trim().toUpperCase();
    if (sym) openSymbol(sym, null, lane);
  };

  useLayoutEffect(() => {
    applyDeepLinkOrRestoreSelection();
  }, [openIntent, searchParams, allCards, selectedId]);

  // Safety net: `useSearchParams` can hydrate one frame after `window.location`.
  useEffect(() => {
    applyDeepLinkOrRestoreSelection();
  }, [openIntent, searchParams, allCards, selectedId]);

  // Tabs left open overnight keep React state — reset when the calendar day turns.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (peekTradingRoomOpenIntent()) return;
      if (!isFirstVisitOfTradingDay()) return;
      resetToMarketBrief();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pathname, searchParams]);

  // Top setup for the brief CTA: hottest actionable, else hottest overall.
  const topCard = useMemo(
    () => ranked.find((c) => c.state === "actionable") ?? ranked[0] ?? null,
    [ranked]
  );

  const counts = useMemo(() => {
    const acc: Record<FeedState, number> = { actionable: 0, near: 0, potential: 0, cooling: 0 };
    for (const c of allCards) acc[c.state] += 1;
    return acc;
  }, [allCards]);

  // Resolve the displayed index moves first (scanner overview, else live snapshots)
  // so the regime headline is classified from the *same* numbers the chips show —
  // otherwise a closed-weekend tape (empty scanner overview) reads "Neutral" above
  // red index chips.
  const spyPct = scannerOverview.spyPct ?? snapPct(snapshotsBySymbol.get("SPY"));
  const qqqPct = scannerOverview.qqqPct ?? snapPct(snapshotsBySymbol.get("QQQ"));
  const iwmPct = snapPct(snapshotsBySymbol.get("IWM"));

  // Prefer the backend weighted macro regime (single source of truth — same engine
  // that gates setups and the morning brief). Fall back to the index-return
  // classifier when the macro read is unavailable (e.g. cold cache). The sanity
  // guard is the final net so a sharply red tape can never read "Neutral".
  const regimeLabel = resolveSessionRegimeLabel({
    macroRegime: macro?.market_regime,
    scannerError: scannerOverview.error,
    scannerRegimeLabel: scannerOverview.regimeLabel,
    spyPct: typeof spyPct === "number" ? spyPct : null,
    qqqPct: typeof qqqPct === "number" ? qqqPct : null
  });

  const vixSnap =
    snapshotsBySymbol.get("I:VIX") ?? snapshotsBySymbol.get("^VIX") ?? snapshotsBySymbol.get("VIX");
  const vixLevel =
    typeof vixSnap?.last_trade_price === "number" && Number.isFinite(vixSnap.last_trade_price)
      ? vixSnap.last_trade_price
      : null;
  const vixPct = snapPct(vixSnap);

  // "What to watch": nearest high-importance macro event, else next earnings.
  const watch = useMemo(() => {
    const events = [...(macro?.upcoming_events ?? [])]
      .filter((e) => typeof e.hours_until === "number")
      .sort((a, b) => a.hours_until - b.hours_until);
    const top = events.find((e) => e.importance >= 2) ?? events[0];
    if (top) {
      return {
        line: top.name,
        detail: top.warning ?? (macro?.macro_risk ? `${macro.macro_risk}` : null)
      };
    }
    const next = [...earnings.upcoming]
      .filter((e) => e.report_date?.trim())
      .sort((a, b) => a.report_date.localeCompare(b.report_date))[0];
    if (next) {
      return { line: `${next.symbol} earnings ${next.report_date}`, detail: next.company_name || null };
    }
    return { line: null as string | null, detail: null as string | null };
  }, [macro?.upcoming_events, macro?.macro_risk, earnings.upcoming]);

  // Client-tracked last-refresh time: stamped whenever any live data source
  // resolves or revalidates. Acts as the final fallback so the header's
  // "Market data as of" always shows a real time rather than a bare dash.
  const [lastRefreshedIso, setLastRefreshedIso] = useState<string | null>(null);
  useEffect(() => {
    setLastRefreshedIso(new Date().toISOString());
    // `newsArticles` can be a fresh [] each render while loading — key off its
    // length (stable) plus the SWR data refs (stable until a real revalidation).
  }, [swingDesk?.data, dayDesk?.data, newsArticles.length, aiBrief]);

  const updatedAtIso =
    swingDesk?.data?.generated_at ??
    dayDesk?.data?.generated_at ??
    marketStatus?.server_time ??
    lastRefreshedIso;

  const marketOpen = marketStatus ? isRegularSessionOpen(marketStatus) : null;
  const marketStatusLabel = marketStatusLabelFor(marketStatus?.market, marketOpen);

  // Sectors: prefer the latest-session move when the tape is shut (that's "today"),
  // otherwise lean on the 5-day rotation for a steadier leadership read.
  const sectors = useMemo<BriefSector[]>(() => {
    const useDaily = marketOpen === false;
    const result: BriefSector[] = [];
    for (const row of sectorRotation) {
      const pct = useDaily ? (row.pct1d ?? row.pct5d) : (row.pct5d ?? row.pct1d);
      if (pct == null) continue;
      result.push({ label: row.label, pct, pct1d: row.pct1d ?? null, pct5d: row.pct5d ?? null });
    }
    return result.sort((a, b) => b.pct - a.pct);
  }, [sectorRotation, marketOpen]);
  const sectorWindowLabel = marketOpen === false ? "today" : "past week";

  // Notable movers from what we're actively tracking (real intraday % moves).
  const movers = useMemo(() => {
    const withPct = allCards
      .filter((c) => typeof c.changePct === "number" && Number.isFinite(c.changePct))
      .map((c) => ({ symbol: c.symbol, company: c.company ?? null, changePct: c.changePct as number }));
    const seen = new Set<string>();
    const dedup: BriefMover[] = [];
    for (const m of withPct) {
      if (seen.has(m.symbol)) continue;
      seen.add(m.symbol);
      dedup.push(m);
    }
    const up = [...dedup].sort((a, b) => b.changePct - a.changePct).filter((m) => m.changePct > 0).slice(0, 3);
    const down = [...dedup].sort((a, b) => a.changePct - b.changePct).filter((m) => m.changePct < 0).slice(0, 3);
    return { up, down };
  }, [allCards]);

  const sessionNarrative = useMemo(
    () => buildSessionNarrative({ marketOpen, spyPct, qqqPct, iwmPct, vixLevel, vixPct, sectors }),
    [marketOpen, spyPct, qqqPct, iwmPct, vixLevel, vixPct, sectors]
  );

  const headlines = useMemo<BriefHeadline[]>(
    () =>
      newsArticles.slice(0, 6).map((a, i) => ({
        id: a.article_id || a.id || `news-${i}`,
        title: a.title,
        source: a.source || a.publisher?.name || null,
        ageLabel: newsAgeLabel(a.published_at || a.published_utc),
        sentiment: mapNewsSentiment(a.sentiment),
        url: a.url || a.article_url || null,
        impact: a.impact_summary?.trim() || null
      })),
    [newsArticles]
  );

  // Session phase drives the brief's lead line, CTA copy, and which preparation
  // blocks surface. Weekend / after-hours are the "prep" surfaces.
  const sessionPhase = resolveBriefSessionPhase(marketOpen);
  const showPrep = isPreparationPhase(sessionPhase);

  // Preparation data is fetched only when the desk is in a prep phase — the live
  // session has its own surfaces (feed, rail) and shouldn't pay for these calls.
  const watchlistAtClose = useWatchlistAtClose(showPrep, "swing");
  const outcomes = useWeeklySetupOutcomes(showPrep, "swing", 30);

  // "Looking ahead": macro/earnings events in the coming days, soonest first.
  const weekAhead = useMemo<BriefWeekEvent[]>(() => {
    const events = [...(macro?.upcoming_events ?? [])]
      .filter((e) => typeof e.hours_until === "number" && e.hours_until >= -6 && e.hours_until <= 24 * 8)
      .sort((a, b) => a.hours_until - b.hours_until);
    return events.slice(0, 5).map((e) => ({
      label: e.name,
      when: formatEventWhen(e.scheduled_time, e.hours_until),
      importance: e.importance ?? 0
    }));
  }, [macro?.upcoming_events]);

  // "Week in review": best/worst sector by 5-day move — factual market data only.
  const weekInReview = useMemo<BriefWeekInReview | null>(() => {
    const with5d = sectors.filter((s): s is BriefSector & { pct5d: number } => typeof s.pct5d === "number" && Number.isFinite(s.pct5d));
    if (with5d.length === 0) return null;
    const sorted = [...with5d].sort((a, b) => b.pct5d - a.pct5d);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    return {
      bestSector: best ? { label: best.label, pct5d: best.pct5d } : null,
      worstSector: worst && worst.label !== best?.label ? { label: worst.label, pct5d: worst.pct5d } : null
    };
  }, [sectors]);

  const outcomesRecap = useMemo<BriefOutcomesRecap | null>(() => {
    if (!outcomes) return null;
    return {
      windowDays: outcomes.days,
      totalEvents: outcomes.stats.total_events,
      buildingDataset: outcomes.stats.building_dataset,
      alignmentHeldRate: outcomes.stats.alignment_held_rate ?? null,
      continuationRate: outcomes.stats.setup_continuation_rate ?? null,
      disclaimer: outcomes.disclaimer
    };
  }, [outcomes]);

  // Top swing card for the weekend prep highlight in the Market Brief.
  // Uses the "all swing cards" list (pre-filter) so the brief always surfaces
  // the hottest setup even if the user's filters would hide it.
  const topSwingCard = useMemo(
    () => allCards.filter((c) => c.lane === "swing").sort((a, b) => {
      const stateOrder: Record<string, number> = { actionable: 0, near: 1, potential: 2, cooling: 3 };
      const byState = (stateOrder[a.state] ?? 4) - (stateOrder[b.state] ?? 4);
      if (byState !== 0) return byState;
      return b.rankScore - a.rankScore;
    })[0] ?? null,
    [allCards]
  );
  const swingCardCount = allCards.filter((c) => c.lane === "swing").length;

  const briefData: MarketBriefData = {
    userName: userName ?? null,
    marketOpen,
    marketStatusLabel,
    regimeLabel,
    marketRegime: macro?.market_regime ?? null,
    macroScore: macro?.macro_score ?? null,
    sessionNarrative,
    aiNarrative: aiBrief?.available ? aiBrief.narrative : null,
    spyPct,
    qqqPct,
    iwmPct,
    vixLevel,
    vixPct,
    breadthLine: null,
    sectors,
    sectorWindowLabel,
    movers,
    headlines,
    counts,
    topCard,
    watchLine: watch.line,
    watchDetail: watch.detail,
    updatedAtIso,
    sessionPhase,
    weekAhead,
    watchlistAtClose,
    weekInReview,
    outcomesRecap,
    topSwingCard,
    swingCardCount,
    swingDataDate: staleDateLabel
  };

  // Use the unfiltered allCards count so active user filters never accidentally hide the
  // feed panel (e.g. "Day only" filter with no day cards but swing cards still in allCards).
  const deskEmpty = allCards.length === 0;

  const isWeekendSession = sessionPhase === "weekend";
  // Keep the signal feed column mounted every session. Quiet days (zero qualified
  // setups) still surface session activity / building structure via QuietFeed —
  // collapsing the column on weekdays left users with no left pane all day.
  const gridTemplate = watchlistOpen
    ? `300px minmax(0, 1fr) 300px`
    : `300px minmax(0, 1fr) 44px`;

  const dayDeskStale = isDeskCacheStale(dayDesk);

  const feedPanel = isMobile ? (
    <MobileFeedPanel
      open={feedOpen}
      onToggleOpen={toggleFeedOpen}
      feedCount={allCards.length}
      quickSwitchCards={selected ? allCards : []}
      selectedId={selected?.id ?? null}
      onSelectCard={selectCard}
      colors={colors}
      trackedPlanKeys={trackedPlanKeys}
    >
      <SignalFeed
        day={day}
        swing={swing}
        showDay={dayTradingSurfaces}
        selectedId={selected?.id ?? null}
        deskEmpty={deskEmpty}
        swingDeskData={swingDesk?.data}
        dayDeskData={dayDesk?.data}
        dayDeskStale={dayDeskStale}
        deskWarmupLoading={deskWarmupLoading}
        snapshotsBySymbol={snapshotsBySymbol}
        companyBySymbol={resolvedCompanyBySymbol}
        onSelectCard={selectCard}
        isMobile={isMobile}
        colors={colors}
        staleDateLabel={staleDateLabel}
        isWeekend={isWeekendSession}
        feedEnvironment={feedEnvironment}
        swingEnvironment={swingEnvironment}
        dayEnvironment={dayEnvironment}
        onRefreshFeedCard={handleRefreshFeedCard}
        refreshingCardIds={refreshingCardIds}
        trackedPlanKeys={trackedPlanKeys}
      />
    </MobileFeedPanel>
  ) : (
    <SignalFeed
      day={day}
      swing={swing}
      showDay={dayTradingSurfaces}
      selectedId={selected?.id ?? null}
      deskEmpty={deskEmpty}
      swingDeskData={swingDesk?.data}
      dayDeskData={dayDesk?.data}
      dayDeskStale={dayDeskStale}
      deskWarmupLoading={deskWarmupLoading}
      snapshotsBySymbol={snapshotsBySymbol}
      companyBySymbol={resolvedCompanyBySymbol}
      onSelectCard={selectCard}
      isMobile={isMobile}
      colors={colors}
      staleDateLabel={staleDateLabel}
      isWeekend={isWeekendSession}
      feedEnvironment={feedEnvironment}
      swingEnvironment={swingEnvironment}
      dayEnvironment={dayEnvironment}
      onRefreshFeedCard={handleRefreshFeedCard}
      refreshingCardIds={refreshingCardIds}
      trackedPlanKeys={trackedPlanKeys}
    />
  );
  const centerPanel = selected ? (
    <DeepDive
      card={selected}
      allCards={cardsWithNames}
      companyBySymbol={resolvedCompanyBySymbol}
      snapshot={snapshotsBySymbol.get(selected.symbol) ?? null}
      onBackToBrief={() => select(null)}
      isMobile={isMobile}
      colors={colors}
      dataRefreshNonce={centerDataRefreshNonce}
    />
  ) : (
    <MarketBrief data={briefData} onViewTopSetup={() => topCard && selectCard(topCard)} onSearch={undefined} />
  );
  // Build live bias map from current desk data for watchlist rail
  const liveBiasBySymbol = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of allCards) {
      // Use card bias (from live desk data) to override stale maturation bias
      const biasStr = card.bias === "bull" ? "long" : card.bias === "bear" ? "short" : "neutral";
      map.set(card.symbol, biasStr);
    }
    return map;
  }, [allCards]);

  const railPanel = (
    <WatchlistRail
      mode="swing"
      selectedId={selected?.id ?? null}
      onSelectCard={selectCard}
      companyBySymbol={resolvedCompanyBySymbol}
      open={watchlistOpen}
      onToggleOpen={toggleWatchlistOpen}
      isMobile={isMobile}
      colors={colors}
      liveBiasBySymbol={liveBiasBySymbol}
      onRefreshCard={handleRefreshFeedCard}
      refreshingCardIds={refreshingCardIds}
    />
  );

  // Full-bleed amount: pull the header/filter bands out to the edges of the
  // padded <main> so they read as flush, edge-to-edge bars (prototype). The
  // value mirrors the <main> horizontal padding, which switches at the same
  // 900px breakpoint the dashboard uses.
  const bleed = isMobile ? spacing[4] : spacing[6];

  const wrapPanel = (node: ReactNode, lane: "feed" | "center" | "rail") => (
    <div
      className={`trading-room-panel trading-room-panel--${lane}${isMobile ? "" : " trading-room-column"}`}
      data-testid={`trading-room-panel-${lane}`}
      style={
        !isMobile && lane === "feed"
          ? { paddingRight: spacing[3], borderRight: `1px solid ${colors.border}` }
          : undefined
      }
    >
      {node}
    </div>
  );

  return (
    <section
      className="stocvest-dashboard-v2"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        color: colors.text,
        ...(isMobile
          ? {}
          : {
              height: "calc(100dvh - 1.5rem)",
              maxHeight: "calc(100dvh - 1.5rem)",
              overflow: "hidden"
            })
      }}
    >
      <TradingRoomMountRefresh
        dayTradingSurfaces={dayTradingSurfaces}
        sidebarSymbols={sidebarRefreshSymbols}
      />
      <TradingRoomPeriodicRefresh
        dayTradingSurfaces={dayTradingSurfaces}
        feedSymbols={sidebarRefreshSymbols}
        selectedCard={selected ? { symbol: selected.symbol, lane: selected.lane } : null}
      />
      <AppSessionHeader
        regimeLabel={regimeLabel}
        spyPct={spyPct}
        qqqPct={qqqPct}
        iwmPct={iwmPct}
        vixLevel={vixLevel}
        marketStatusLabel={marketStatusLabel}
        marketOpen={marketOpen}
        counts={counts}
        updatedAtIso={updatedAtIso}
        onOpenSymbol={openSymbol}
        bleed={bleed}
        isMobile={isMobile}
        colors={colors}
      />

      <div style={{ paddingLeft: bleed, paddingRight: bleed }}>
        <TrackedPlansAlertStrip />
      </div>

      {/* Hide the filter bar when the desk is quiet — there's nothing to filter,
          and the feed shows the "building structure / session activity" view. */}
      {allCards.length > 0 ? (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          showDay={dayTradingSurfaces}
          bleed={bleed}
          isMobile={isMobile}
          colors={colors}
        />
      ) : null}

      <div
        className="trading-room-layout"
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : gridTemplate,
          gridTemplateRows: isMobile ? undefined : "minmax(0, 1fr)",
          gap: spacing[4],
          alignItems: isMobile ? "start" : "stretch",
          marginTop: spacing[5],
          flex: isMobile ? undefined : "1 1 0%",
          minHeight: isMobile ? undefined : 0,
          overflow: isMobile ? undefined : "hidden"
        }}
      >
        {wrapPanel(feedPanel, "feed")}
        {wrapPanel(centerPanel, "center")}
        {wrapPanel(railPanel, "rail")}
      </div>
    </section>
  );
}

/* ── Filter bar ─────────────────────────────────────────────────────────── */

function FilterBar({
  filters,
  onChange,
  showDay,
  bleed,
  isMobile = false,
  colors
}: {
  filters: FeedFilters;
  onChange: (f: FeedFilters) => void;
  showDay: boolean;
  bleed: string;
  isMobile?: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  // Lane = the prototype's mode pillset: Day reads electric-blue, Swing violet.
  const laneOpts: SegOption<FeedFilters["lane"]>[] = showDay
    ? [
        { id: "all", label: "All" },
        { id: "day", label: "Day", icon: "⚡", activeColor: colors.accent },
        { id: "swing", label: "Swing", icon: "◈", activeColor: SWING_ACCENT }
      ]
    : [
        { id: "all", label: "All" },
        { id: "swing", label: "Swing", icon: "◈", activeColor: SWING_ACCENT }
      ];
  const stateOpts: SegOption<FeedFilters["state"]>[] = [
    { id: "all", label: "All states" },
    { id: "actionable", label: "Actionable" },
    { id: "near", label: "Near" },
    { id: "potential", label: "Potential" }
  ];
  const biasOpts: SegOption<FeedFilters["bias"]>[] = [
    { id: "all", label: "Both" },
    { id: "long", label: "Long" },
    { id: "short", label: "Short" }
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: spacing[4],
        alignItems: "center",
        // Mobile: keep the pillsets on one line and let them scroll horizontally
        // rather than wrapping into a tall stack.
        flexWrap: isMobile ? "nowrap" : "wrap",
        overflowX: isMobile ? "auto" : "visible",
        padding: `${spacing[2]} ${bleed}`,
        marginLeft: `-${bleed}`,
        marginRight: `-${bleed}`,
        background: colors.background,
        borderBottom: `1px solid ${colors.border}`
      }}
    >
      <SegGroup
        value={filters.lane}
        options={laneOpts}
        onSelect={(v) => onChange({ ...filters, lane: v })}
        colors={colors}
      />
      <SegGroup
        value={filters.state}
        options={stateOpts}
        onSelect={(v) => onChange({ ...filters, state: v })}
        colors={colors}
      />
      <SegGroup
        value={filters.bias}
        options={biasOpts}
        onSelect={(v) => onChange({ ...filters, bias: v })}
        colors={colors}
      />
    </div>
  );
}

type SegOption<T extends string> = {
  id: T;
  label: string;
  /** Optional leading glyph (e.g. ⚡ for Day, ◈ for Swing). */
  icon?: string;
  /** Optional active text color — Day = electric blue, Swing = violet. */
  activeColor?: string;
};

function SegGroup<T extends string>({
  value,
  options,
  onSelect,
  colors
}: {
  value: T;
  options: SegOption<T>[];
  onSelect: (v: T) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 3,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.full
      }}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        const activeColor = opt.activeColor ?? colors.text;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onSelect(opt.id)}
            style={{
              border: "none",
              background: active ? colors.surfaceMuted : "transparent",
              boxShadow: active ? `inset 0 0 0 1px ${colors.border}` : "none",
              color: active ? activeColor : colors.textMuted,
              fontSize: typography.scale.xs,
              fontWeight: 600,
              padding: "5px 13px",
              borderRadius: borderRadius.full,
              cursor: "pointer",
              transition: "color .14s, background .14s",
              whiteSpace: "nowrap"
            }}
          >
            {opt.icon ? <span style={{ marginRight: 5 }}>{opt.icon}</span> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Mobile desk feed shell (left pane) ───────────────────────────────────── */

function MobileFeedChipStrip({
  cards,
  selectedId,
  onSelectCard,
  colors,
  trackedPlanKeys
}: {
  cards: FeedCard[];
  selectedId: string | null;
  onSelectCard: (card: FeedCard) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  trackedPlanKeys?: Set<string>;
}) {
  if (cards.length === 0) return null;
  return (
    <div
      className="trading-room-feed-chips"
      data-testid="trading-room-feed-chips"
      style={{
        display: "flex",
        gap: spacing[2],
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        paddingBottom: spacing[1],
        marginBottom: spacing[2]
      }}
    >
      {cards.map((card) => {
        const active = card.id === selectedId;
        const tone = stateTone(card.state, colors);
        const hasPlan = trackedPlanKeys?.has(feedCardTrackedPlanKey(card)) ?? false;
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelectCard(card)}
            data-testid={`feed-chip-${card.symbol}`}
            style={{
              flex: "0 0 auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: `1px solid ${active ? colors.accent : colors.border}`,
              background: active ? "rgba(59,130,246,0.14)" : colors.surface,
              color: active ? colors.accent : colors.text,
              borderRadius: borderRadius.full,
              padding: "6px 12px",
              fontSize: typography.scale.xs,
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap"
            }}
          >
            <span
              aria-hidden
              style={{ width: 6, height: 6, borderRadius: "50%", background: tone, flex: "none" }}
            />
            {card.symbol}
            {hasPlan ? <TrackedPlanBadge colors={colors} compact /> : null}
            <span style={{ color: colors.textMuted, fontWeight: 600 }}>{feedCardStateLabel(card)}</span>
          </button>
        );
      })}
    </div>
  );
}

function MobileFeedPanel({
  open,
  onToggleOpen,
  feedCount,
  quickSwitchCards,
  selectedId,
  onSelectCard,
  colors,
  trackedPlanKeys,
  children
}: {
  open: boolean;
  onToggleOpen: () => void;
  feedCount: number;
  quickSwitchCards: FeedCard[];
  selectedId: string | null;
  onSelectCard: (card: FeedCard) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  trackedPlanKeys?: Set<string>;
  children: ReactNode;
}) {
  if (!open) {
    return (
      <div data-testid="trading-room-mobile-feed">
        {quickSwitchCards.length > 0 ? (
          <MobileFeedChipStrip
            cards={quickSwitchCards}
            selectedId={selectedId}
            onSelectCard={onSelectCard}
            colors={colors}
            trackedPlanKeys={trackedPlanKeys}
          />
        ) : null}
        <button
          type="button"
          onClick={onToggleOpen}
          aria-label="Open desk feed"
          aria-expanded={false}
          data-testid="trading-room-feed-toggle"
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing[2],
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            color: colors.textMuted,
            fontSize: typography.scale.xs,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
            padding: `${spacing[3]} ${spacing[4]}`
          }}
        >
          <span>
            Desk feed{feedCount ? ` · ${feedCount}` : ""}
          </span>
          <span aria-hidden>▾</span>
        </button>
      </div>
    );
  }

  return (
    <aside
      data-testid="trading-room-mobile-feed"
      className="trading-room-mobile-side-pane"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        padding: spacing[3],
        display: "flex",
        flexDirection: "column",
        gap: spacing[3]
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing[2] }}>
        <span
          style={{
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            letterSpacing: "0.1em",
            textTransform: "uppercase"
          }}
        >
          Desk feed{feedCount ? ` · ${feedCount}` : ""}
        </span>
        <button
          type="button"
          onClick={onToggleOpen}
          aria-label="Close desk feed"
          aria-expanded
          data-testid="trading-room-feed-close"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "transparent",
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            color: colors.textMuted,
            cursor: "pointer",
            fontSize: typography.scale.xs,
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            padding: "4px 8px"
          }}
        >
          <PanelLeftClose size={14} aria-hidden />
          Close
        </button>
      </div>
      <div className="trading-room-mobile-side-pane-body" style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
        {children}
      </div>
    </aside>
  );
}

/* ── Signal feed ────────────────────────────────────────────────────────── */

function SignalFeed({
  day,
  swing,
  showDay,
  selectedId,
  deskEmpty,
  swingDeskData,
  dayDeskData,
  dayDeskStale = false,
  deskWarmupLoading = false,
  snapshotsBySymbol,
  companyBySymbol,
  onSelectCard,
  isMobile = false,
  colors,
  staleDateLabel = null,
  isWeekend = false,
  feedEnvironment = null,
  swingEnvironment = null,
  dayEnvironment = null,
  onRefreshFeedCard,
  refreshingCardIds,
  trackedPlanKeys
}: {
  day: FeedCard[];
  swing: FeedCard[];
  showDay: boolean;
  selectedId: string | null;
  deskEmpty: boolean;
  swingDeskData: DeskTodayData | null | undefined;
  dayDeskData: DeskTodayData | null | undefined;
  dayDeskStale?: boolean;
  deskWarmupLoading?: boolean;
  snapshotsBySymbol: Map<string, SnapshotPayload>;
  companyBySymbol: Map<string, string>;
  onSelectCard: (card: FeedCard) => void;
  isMobile?: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
  /** When non-null, swing data is from a previous trading day — shown in the section header. */
  staleDateLabel?: string | null;
  /** True when it is a weekend — shows a weekend-specific empty message instead of hiding the feed. */
  isWeekend?: boolean;
  feedEnvironment?: MarketEnvironmentPayload | null;
  swingEnvironment?: MarketEnvironmentPayload | null;
  dayEnvironment?: MarketEnvironmentPayload | null;
  onRefreshFeedCard?: (card: FeedCard) => void | Promise<void>;
  refreshingCardIds?: Set<string>;
  trackedPlanKeys?: Set<string>;
}) {
  const empty = day.length === 0 && swing.length === 0;
  // Desktop scroll lives on `.trading-room-column--feed` (prototype zone model).
  const paneStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: spacing[4] };
  const body = (
    <>
      {feedEnvironment ? (
        <MarketEnvironmentStrip environment={feedEnvironment} testId="trading-room-environment-strip" />
      ) : null}
      {showDay &&
      dayEnvironment &&
      swingEnvironment &&
      dayEnvironment.environment_tier !== swingEnvironment.environment_tier ? (
        <p className="m-0 text-[11px] leading-snug" style={{ color: colors.textMuted }}>
          Day desk: {dayEnvironment.headline}
        </p>
      ) : null}
      {showDay ? (
        <>
          {dayDeskStale || deskWarmupLoading ? (
            <p className="m-0 text-[10px] leading-snug" style={{ color: colors.textMuted }}>
              {deskWarmupLoading
                ? "Day desk is warming up — session movers will appear shortly."
                : "Day desk is using the last cached refresh — live desk data is catching up."}
            </p>
          ) : null}
          <FeedLaneSection
            title="Day"
            count={day.length}
            cards={day}
            selectedId={selectedId}
            onSelectCard={onSelectCard}
            colors={colors}
            environment={dayEnvironment}
            onRefreshFeedCard={onRefreshFeedCard}
            refreshingCardIds={refreshingCardIds}
            trackedPlanKeys={trackedPlanKeys}
          />
        </>
      ) : null}
      <FeedLaneSection
        title="Swing"
        count={swing.length}
        cards={swing}
        selectedId={selectedId}
        onSelectCard={onSelectCard}
        colors={colors}
        staleLabel={staleDateLabel}
        environment={swingEnvironment}
        onRefreshFeedCard={onRefreshFeedCard}
        refreshingCardIds={refreshingCardIds}
        trackedPlanKeys={trackedPlanKeys}
      />
      {empty ? (
        deskEmpty || isWeekend ? (
          <>
            {isWeekend && deskEmpty ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: spacing[2],
                  padding: spacing[3],
                  borderRadius: 8,
                  border: `1px solid #c04cf533`,
                  background: "#c04cf50d"
                }}
              >
                <span style={{ fontSize: typography.scale.xs, color: "#c04cf5", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Weekend · Markets closed
                </span>
                <span style={{ fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
                  Friday&apos;s swing signals will appear here once the desk cache refreshes. Your existing watchlist and signal deep dives are still accessible.
                </span>
              </div>
            ) : null}
            {swingDeskData || dayDeskData ? (
              <QuietFeed
                swingDesk={swingDeskData}
                dayDesk={dayDeskData}
                showDay={showDay}
                snapshotsBySymbol={snapshotsBySymbol}
                companyBySymbol={companyBySymbol}
                selectedId={selectedId}
                onSelectCard={onSelectCard}
                colors={colors}
              />
            ) : (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
                No qualified setups on the desk right now. Use the header search to open any symbol, or check back after
                the next desk refresh.
              </p>
            )}
          </>
        ) : (
          <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
            No setups match the current filters. Try widening the filters above — the desk has names in other lanes.
          </p>
        )
      ) : null}
    </>
  );
  return <div style={paneStyle}>{body}</div>;
}

function FeedLaneSection({
  title,
  count,
  cards,
  selectedId,
  onSelectCard,
  colors,
  staleLabel = null,
  environment = null,
  onRefreshFeedCard,
  refreshingCardIds,
  trackedPlanKeys
}: {
  title: string;
  count: number;
  cards: FeedCard[];
  selectedId: string | null;
  onSelectCard: (card: FeedCard) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  /** When non-null, shown beside the count as a staleness badge (e.g. "Fri Jun 6 close"). */
  staleLabel?: string | null;
  environment?: MarketEnvironmentPayload | null;
  onRefreshFeedCard?: (card: FeedCard) => void | Promise<void>;
  refreshingCardIds?: Set<string>;
  trackedPlanKeys?: Set<string>;
}) {
  if (cards.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      {/* Section label + count + optional staleness badge + divider rule. */}
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
        <span
          style={{
            fontSize: 10.5,
            color: colors.textMuted,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            whiteSpace: "nowrap"
          }}
        >
          {title} <span style={{ color: colors.text, fontWeight: 600 }}>{count}</span>
        </span>
        {staleLabel ? (
          <span
            style={{
              fontSize: 10,
              color: "#c04cf5",
              background: "#c04cf51a",
              border: "1px solid #c04cf533",
              borderRadius: 999,
              padding: "1px 8px",
              whiteSpace: "nowrap",
              fontWeight: 600,
              letterSpacing: "0.08em"
            }}
          >
            {staleLabel} close
          </span>
        ) : null}
        <span style={{ flex: 1, height: 1, background: colors.border }} />
      </div>
      {cards.map((card) => (
        <SignalCard
          key={card.id}
          card={card}
          active={card.id === selectedId}
          onSelectCard={onSelectCard}
          colors={colors}
          showLaneBadge={false}
          staleDate={staleLabel}
          environmentHint={environmentSessionCardHint(environment, card.lane, card.state)}
          onRefresh={onRefreshFeedCard ? () => onRefreshFeedCard(card) : undefined}
          refreshing={refreshingCardIds?.has(card.id) ?? false}
          hasTrackedPlan={trackedPlanKeys?.has(feedCardTrackedPlanKey(card)) ?? false}
        />
      ))}
    </div>
  );
}

function biasPillStyle(bias: FeedBias, colors: ReturnType<typeof useTheme>["colors"]): CSSProperties {
  const tone = bias === "bull" ? colors.bullish : bias === "bear" ? colors.bearish : colors.textMuted;
  return {
    display: "inline-block",
    fontSize: typography.scale.xs,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: tone,
    background: `${tone}1f`,
    padding: "2px 8px",
    borderRadius: borderRadius.full
  };
}

function stateTone(state: FeedState, colors: ReturnType<typeof useTheme>["colors"]): string {
  if (state === "actionable") return colors.bullish;
  if (state === "near") return colors.caution;
  if (state === "cooling") return colors.bearish;
  return colors.textMuted;
}

function SignalCard({
  card,
  active,
  onSelectCard,
  colors,
  showLaneBadge = true,
  staleDate = null,
  environmentHint = null,
  onRefresh,
  refreshing = false,
  hasTrackedPlan = false
}: {
  card: FeedCard;
  active: boolean;
  onSelectCard: (card: FeedCard) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  /** Hide when the card already sits under a Day/Swing section header. */
  showLaneBadge?: boolean;
  /** When non-null, this card's price data is from a prior day — shown as a small badge. */
  staleDate?: string | null;
  /** Layer 0 ledger policy hint for actionable/near cards in elevated/stressed sessions. */
  environmentHint?: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  hasTrackedPlan?: boolean;
}) {
  const biasAccent = feedBiasColor(card.bias, colors);
  const sTone = stateTone(card.state, colors);
  const pct = card.changePct;
  const pctTone = pct == null ? colors.textMuted : pct >= 0 ? colors.bullish : colors.bearish;
  return (
    <div
      data-testid={`signal-card-${card.symbol}`}
      style={{
        position: "relative",
        width: "100%",
        background: active ? colors.surfaceMuted : colors.surface,
        border: `1px solid ${active ? colors.accent : colors.border}`,
        borderLeft: `3px solid ${biasAccent}`,
        borderBottom: `3px solid ${biasAccent}`,
        borderRadius: borderRadius.md,
        opacity: card.state === "cooling" ? 0.7 : 1
      }}
    >
      {onRefresh ? (
        <div style={{ position: "absolute", top: spacing[3], right: spacing[3], zIndex: 1 }}>
          <CardRefreshButton
            label={`Refresh ${card.symbol} ${card.lane}`}
            busy={refreshing}
            colors={colors}
            onRefresh={onRefresh}
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => onSelectCard(card)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          borderRadius: borderRadius.md,
          padding: spacing[3],
          paddingRight: onRefresh ? `calc(${spacing[3]} + 28px)` : spacing[3],
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          gap: spacing[1],
          color: colors.text
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: spacing[2] }}>
          <span style={{ display: "flex", alignItems: "center", gap: spacing[2], minWidth: 0 }}>
            <span style={{ fontSize: typography.scale.base, fontWeight: 700 }}>{card.symbol}</span>
            {showLaneBadge ? <span style={laneBadgeStyle(colors)}>{card.lane}</span> : null}
            {hasTrackedPlan ? <TrackedPlanBadge colors={colors} compact /> : null}
          </span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: typography.scale.sm, fontWeight: 600, color: pctTone }}>{fmtPrice(card.price)}</span>
            {pct != null ? (
              <span style={{ fontSize: typography.scale.xs, color: pctTone }}>
                {fmtPct(pct)}
                {staleDate ? <span style={{ color: colors.textMuted, fontWeight: 400 }}> {staleDate.slice(0, 3).toLowerCase()}</span> : null}
              </span>
            ) : null}
          </span>
        </div>
        {card.company ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{card.company}</span>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: spacing[2], marginTop: 2 }}>
          <span style={biasPillStyle(card.bias, colors)}>
            {card.bias === "bull" ? "Bullish" : card.bias === "bear" ? "Bearish" : "Neutral"}
          </span>
          <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: sTone }}>{feedCardStateLabel(card)}</span>
        </div>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.4 }}>{card.verdict}</span>
        {environmentHint ? (
          <span
            data-testid={`signal-card-environment-hint-${card.symbol}`}
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: colors.caution,
              lineHeight: 1.35
            }}
          >
            {environmentHint}
          </span>
        ) : null}
        {staleDate ? (
          <span style={{ fontSize: 10, color: "#c04cf5", marginTop: 2 }}>
            from {staleDate} · valid through weekend
          </span>
        ) : null}
        <FeedCardUpdatedLine iso={card.lastEvaluatedAt} colors={colors} />
      </button>
    </div>
  );
}

