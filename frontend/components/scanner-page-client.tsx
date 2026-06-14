"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties
} from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { GapCatalystNewsDrawer } from "@/components/gap-catalyst-news-drawer";
import { NewsPanel } from "@/components/news-panel";
import { ScenarioBuilderInline } from "@/components/scenario-builder/scenario-builder-inline";
import { ScannerEmptyStateCard } from "@/components/scanner-empty-state-card";
import { ScannerNearQualificationSection } from "@/components/scanner/scanner-near-qualification-section";
import { ScannerMoverLanes } from "@/components/scanner/scanner-mover-lanes";
import { ScannerWhyMissingPanel } from "@/components/scanner/scanner-why-missing-panel";
import { ScannerQuietLeadersSection } from "@/components/scanner/scanner-quiet-leaders-section";
import { ScannerOutcomeCards } from "@/components/scanner/ScannerOutcomeCards";
import { ScannerQuietDesk } from "@/components/scanner/scanner-quiet-desk";
import { ScannerScanResultHero } from "@/components/scanner/scanner-scan-result-hero";
import { LaggardScanner } from "@/components/scanner/LaggardScanner";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner-client-load";
import { fetchScannerTraceBundleClient } from "@/lib/api/scanner-trace-client";
import type { ScannerSynthesis } from "@/lib/scanner-synthesis";
import { buildEvidenceAssistantContext } from "@/lib/assistant/build-evidence-assistant-context";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import type {
  AssistantPageContext,
  AssistantScannerGapSummary,
  AssistantScannerSetupSummary
} from "@/lib/assistant/types";
import type {
  GapIntelligenceItem,
  IntradaySetupPayload,
  ScannerOverview,
  ScannerSetupLoadMode
} from "@/lib/api/scanner";
import { mergeScannerCoreIntoOverview } from "@/lib/scanner-overview-merge";
import { buildScannerScanSummary } from "@/lib/scanner-scan-summary";
import { buildScannerProgressHints } from "@/lib/scanner-progress-messaging";
import type { ScannerEvaluationTraceRow } from "@/lib/scanner-setups-response";
import { fetchEarningsCalendarClient } from "@/lib/api/earnings-client";
import type { EarningsEvent } from "@/lib/api/earnings";
import {
  fetchDeskToday,
  type DeskRetainedPoolRow,
  type DeskTodayData,
  type DeskTodayMode
} from "@/lib/api/desk-today";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { GAP_INTEL_ACTIVE_GUIDANCE, GAP_INTEL_EMPTY_CONTEXT } from "@/lib/scanner-quiet-copy";
import { brokersEnabled } from "@/lib/nav-features";
import { scannerToSignalsHref } from "@/lib/nav/watchlist-signals-deeplink";
import {
  TAB_LABEL_BOTH,
  TAB_LABEL_DAY,
  TAB_LABEL_SWING
} from "@/lib/mode-terminology";
import {
  buildDayEmptyStateContext,
  buildGapIntelEmptyStateContext,
  buildSwingEmptyStateContext,
  type EmptyStateOverviewInput,
  type ScannerEmptyStateContext
} from "@/lib/scanner-empty-state";
import type { ScenarioInput } from "@/lib/scenario/types";
import { overviewRegimeToVolatilityRegime } from "@/lib/scenario/scenario-input-present";
import { DeskModeTabNav } from "@/components/desk-mode-tab-nav";
import { MarketEnvironmentStrip } from "@/components/market-environment-strip";
import { useMarketEnvironment } from "@/lib/hooks/use-market-environment";
import { useSymbolNames } from "@/lib/hooks/use-symbol-names";
import { roleAccents } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { useHoverPrefetch } from "@/lib/hooks/use-hover-prefetch";
import { useScannerGapIntelBatch } from "@/lib/hooks/use-scanner-gap-intel-batch";
import { fetchSymbolMinuteBars } from "@/lib/fetch-symbol-bars";
import { buildEvidenceFromSetup, enrichEvidenceWithComposite, type SignalEvidenceData } from "@/lib/signal-evidence";
import {
  resolveEvidenceTradingMode,
  resolveGapCardTradingMode,
  resolveSetupRowTradingMode
} from "@/lib/scanner-mode-resolution";
import { topSignalStrengthPercent } from "@/lib/top-signal-strength";
import { scannerSignificanceLabel } from "@/lib/scanner-significance-present";
import {
  CONFIDENCE_PERCENT_TIP,
  GAP_INTELLIGENCE_TIP,
  EVENT_SIGNIFICANCE_SCORE_TIP,
  INTRADAY_SETUPS_TIP,
  SETUP_RELATIVE_VOLUME_TIP
} from "@/lib/ui-tooltips";
import { InfoTip } from "@/components/info-tip";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { isUsRegularSessionOpenEt, isAfterOrbCloseEt, isoDateInNewYork } from "@/lib/market-hours-et";
import {
  computePmhFromBars,
  entryZoneFromSnapshot,
  formatVolumeShort,
  gapDirectionContext,
  setupExpiryNote,
  setupPatternLabel
} from "@/lib/scanner-display-helpers";
import type { SnapshotPayload } from "@/lib/api/market";
import {
  ScannerOpenSignalsLink,
  SCANNER_MODE_STORAGE_KEY,
  SECONDARY_SHARED_CATALYST_HEADLINE,
  MONO,
  gapItemDisplayCompany,
  CONFLUENCE_BADGE_STYLE,
  isLongDirection,
  formatSignalFiredTimeEt,
  isSecondarySharedCatalyst,
  EMPTY_DESK_REJECTION_SNAPSHOT,
  extractDeskRejectionSnapshot,
  qualityBarStyle,
  gapSyntheticSetup,
  type DeskRejectionSnapshot,
} from "./scanner-page-helpers";
import { GapIntelCard, type GapIntelCardDeps } from "./scanner-gap-intel-card";

interface ScannerPageClientProps {
  initialOverview: ScannerOverview;
  initialTimestampIso: string;
  /** Subscription-derived default before URL/localStorage override. */
  initialScannerSetupLoadMode?: ScannerSetupLoadMode;
  /** Optional SSR seed; otherwise filled after client scanner + earnings loads. */
  earningsBySymbol?: Record<string, EarningsEvent>;
  /** Swing Pro omits Day / Both scanner modes and intraday-only payloads. */
  dayTradingSurfaces?: boolean;
}

export function ScannerPageClient({
  initialOverview,
  initialTimestampIso,
  initialScannerSetupLoadMode = "swing",
  earningsBySymbol: initialEarningsBySymbol = {},
  dayTradingSurfaces = true
}: ScannerPageClientProps) {
  const { colors, theme } = useTheme();
  const [overview, setOverview] = useState<ScannerOverview>(initialOverview);
  const [scannerSetupMode, setScannerSetupMode] = useState<ScannerSetupLoadMode>(initialScannerSetupLoadMode);
  const [showAdvancedScannerPanels, setShowAdvancedScannerPanels] = useState(false);
  const [earningsBySymbol, setEarningsBySymbol] = useState<Record<string, EarningsEvent>>(() => ({
    ...initialEarningsBySymbol
  }));
  const [showRetainedPool, setShowRetainedPool] = useState(false);
  const [retainedPoolPage, setRetainedPoolPage] = useState(1);
  const [expandedRetainedRowKey, setExpandedRetainedRowKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceLoadingSymbol, setEvidenceLoadingSymbol] = useState<string | null>(null);
  const [newsPanelSymbol, setNewsPanelSymbol] = useState("");
  const [newsPanelOpen, setNewsPanelOpen] = useState(false);
  const [gapNewsDrawerItem, setGapNewsDrawerItem] = useState<GapIntelligenceItem | null>(null);
  const [deskRejections, setDeskRejections] = useState<Record<"swing" | "day", DeskRejectionSnapshot>>({
    swing: EMPTY_DESK_REJECTION_SNAPSHOT,
    day: EMPTY_DESK_REJECTION_SNAPSHOT
  });
  const [whyMissingPrefillSymbol, setWhyMissingPrefillSymbol] = useState<string>("");
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const router = useRouter();
  const [, forceTick] = useState(0);
  const nextScanRef = useRef(0);

  const goToPortfolioOrder = useCallback(
    (params: Record<string, string | undefined>) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== "") p.set(k, v);
      }
      router.push(`/dashboard/portfolio?${p.toString()}`);
    },
    [router]
  );

  const [snapBySymbol, setSnapBySymbol] = useState<Record<string, SnapshotPayload | null>>({});
  const [pmhBySymbol, setPmhBySymbol] = useState<Record<string, number | null>>({});

  const openGapNews = useCallback((item: GapIntelligenceItem) => {
    if (isSecondarySharedCatalyst(item)) {
      setNewsPanelSymbol(item.symbol.trim().toUpperCase());
      setNewsPanelOpen(true);
      return;
    }
    setGapNewsDrawerItem(item);
  }, []);

  useLayoutEffect(() => {
    let next: ScannerSetupLoadMode = "swing";
    try {
      const url = new URL(window.location.href);
      const urlMode = url.searchParams.get("mode");
      const showRetained = url.searchParams.get("retained");
      if (showRetained === "1" || showRetained === "true") {
        setShowRetainedPool(true);
      }
      if (urlMode === "day" || urlMode === "swing" || urlMode === "both") {
        next = urlMode;
      } else {
        try {
          const raw = localStorage.getItem(SCANNER_MODE_STORAGE_KEY);
          if (raw === "day" || raw === "swing" || raw === "both") {
            next = raw;
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      try {
        const raw = localStorage.getItem(SCANNER_MODE_STORAGE_KEY);
        if (raw === "day" || raw === "swing" || raw === "both") {
          next = raw;
        }
      } catch {
        /* ignore */
      }
    }
    if (!dayTradingSurfaces && (next === "day" || next === "both")) {
      next = "swing";
    }
    try {
      localStorage.setItem(SCANNER_MODE_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setScannerSetupMode(next);
    if (!dayTradingSurfaces) {
      try {
        const url = new URL(window.location.href);
        const um = url.searchParams.get("mode");
        if (um === "day" || um === "both") {
          url.searchParams.set("mode", "swing");
          window.history.replaceState(null, "", `${url.pathname}${url.search || ""}${url.hash || ""}`);
        }
      } catch {
        /* ignore */
      }
    }
  }, [dayTradingSurfaces]);

  useEffect(() => {
    try {
      const rawAdvanced = localStorage.getItem("scanner_show_advanced");
      if (rawAdvanced === "0") setShowAdvancedScannerPanels(false);
      if (rawAdvanced === "1") setShowAdvancedScannerPanels(true);
      if (rawAdvanced !== "0" && rawAdvanced !== "1") {
        const legacySimple = localStorage.getItem("scanner_simple_view");
        if (legacySimple === "0") setShowAdvancedScannerPanels(true);
        if (legacySimple === "1") setShowAdvancedScannerPanels(false);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("scanner_show_advanced", showAdvancedScannerPanels ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [showAdvancedScannerPanels]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const core = await loadScannerDataWithoutBrief(null, [], {
        parallelDefaultWatchlist: true,
        includeOpportunityDeskUniverse: true,
        maxUniverseSymbols: 150,
        scannerSetupLoadMode: scannerSetupMode,
        intradayBarLimit: 120,
        daySetupsLimit: 10,
        swingSetupsLimit: 6
      });
      if (cancelled) return;
      if (core.error) {
        setOverview((prev) => ({ ...prev, error: core.error }));
        return;
      }
      setOverview((prev) => mergeScannerCoreIntoOverview(prev, core));
    })();
    return () => {
      cancelled = true;
    };
  }, [scannerSetupMode]);

  useEffect(() => {
    setRetainedPoolPage(1);
    setExpandedRetainedRowKey(null);
  }, [scannerSetupMode, showRetainedPool]);

  useEffect(() => {
    setExpandedRetainedRowKey(null);
  }, [retainedPoolPage]);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (showRetainedPool) {
        url.searchParams.set("retained", "1");
      } else {
        url.searchParams.delete("retained");
      }
      window.history.replaceState(null, "", url.pathname + (url.search || "") + (url.hash || ""));
    } catch {
      /* ignore */
    }
  }, [showRetainedPool]);

  useEffect(() => {
    let cancelled = false;
    const modes: DeskTodayMode[] = dayTradingSurfaces ? ["swing", "day"] : ["swing"];
    void Promise.all(
      modes.map(async (mode) => {
        try {
          const payload = await fetchDeskToday(mode);
          return [mode, extractDeskRejectionSnapshot(payload?.data, mode)] as const;
        } catch {
          return [mode, EMPTY_DESK_REJECTION_SNAPSHOT] as const;
        }
      })
    ).then((rows) => {
      if (cancelled) return;
      setDeskRejections((prev) => {
        const next = { ...prev };
        for (const [mode, snapshot] of rows) {
          next[mode] = snapshot;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [scannerSetupMode, dayTradingSurfaces]);

  const persistScannerMode = useCallback(
    (m: ScannerSetupLoadMode) => {
      if (!dayTradingSurfaces && m !== "swing") return;
      setScannerSetupMode(m);
      try {
        localStorage.setItem(SCANNER_MODE_STORAGE_KEY, m);
      } catch {
        /* ignore */
      }
    // Mirror the new mode into the URL so refreshes / sharing keep the
    // active tab. We use `history.replaceState` rather than the router
    // to avoid an unnecessary navigation + RSC refetch — the page is
    // already mounted, only the query param needs updating. Wrapped in
    // try/catch because `window` is not available in SSR.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", m);
      window.history.replaceState(null, "", url.pathname + (url.search || "") + (url.hash || ""));
    } catch {
      /* ignore */
    }
  },
  [dayTradingSurfaces]
);

  const symbolsKey = useMemo(
    () =>
      [
        ...new Set([
          ...overview.gapIntelligence.map((g) => g.symbol),
          ...overview.setups.map((s) => s.symbol)
        ])
      ]
        .sort()
        .join(","),
    [overview.gapIntelligence, overview.setups]
  );

  useEffect(() => {
    const symbols = symbolsKey.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) {
      setEarningsBySymbol({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetchEarningsCalendarClient(symbols, 2);
      if (cancelled) return;
      setEarningsBySymbol(
        Object.fromEntries([...res.upcoming, ...res.recent].map((e) => [e.symbol.toUpperCase(), e]))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [symbolsKey]);

  const gapMeanVolume = useMemo(() => {
    const vs = overview.gapIntelligence.map((g) => g.volume || 0).filter((v) => v > 0);
    if (!vs.length) return 1;
    return vs.reduce((a, b) => a + b, 0) / vs.length;
  }, [overview.gapIntelligence]);

  const dayVolBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of overview.gapIntelligence) {
      m.set(g.symbol, g.volume || 0);
    }
    return m;
  }, [overview.gapIntelligence]);

  // Swing- vs day-engine ranked lists are partitioned independently. Per the
  // Mode Separation safety perimeter (assistant_prompts.py): "scanner output
  // stays separated by mode. When scanner_focus=both in the page context, the
  // user sees TWO sections, not a single merged table with a mode column."
  // Day results reflect intraday logic only; Swing results reflect
  // daily/weekly logic only — they MUST NOT be sorted together.
  const swingRankedSetups = useMemo(() => {
    return [...overview.setups]
      .filter(
        (s) =>
          s.scanner_mode === "swing_daily" &&
          typeof s.score === "number" &&
          Number.isFinite(s.score)
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, scannerSetupMode === "both" ? 5 : 10);
  }, [overview.setups, scannerSetupMode]);

  const dayRankedSetups = useMemo(() => {
    return [...overview.setups]
      .filter(
        (s) =>
          s.scanner_mode !== "swing_daily" &&
          typeof s.score === "number" &&
          Number.isFinite(s.score)
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, scannerSetupMode === "both" ? 5 : 10);
  }, [overview.setups, scannerSetupMode]);

  const rankedSetups = useMemo(() => {
    if (scannerSetupMode === "swing") return swingRankedSetups;
    if (scannerSetupMode === "day") return dayRankedSetups;
    return [...swingRankedSetups, ...dayRankedSetups];
  }, [scannerSetupMode, swingRankedSetups, dayRankedSetups]);

  const showSwingScanContextBanner = useMemo(() => {
    return (
      scannerSetupMode === "swing" &&
      overview.gapIntelligence.length > 0 &&
      rankedSetups.length === 0
    );
  }, [scannerSetupMode, overview.gapIntelligence.length, rankedSetups.length]);

  const setupsEmptyMessage =
    scannerSetupMode === "swing"
      ? "No swing setups — regime and structure not aligned."
      : scannerSetupMode === "day"
        ? "No day setups — intraday confirmation and session timing not aligned."
        : "No swing or day setups right now.";

  // Render groups feed the two-section layout when scannerSetupMode === "both".
  // Each group carries its own mode-specific vocabulary for the empty state —
  // swing emphasises regime/structure alignment, day emphasises intraday
  // confirmation and session timing. The assistant prompt requires distinct
  // copy per mode ("Never use identical copy for both modes").
  type SetupRenderGroup = {
    key: "swing" | "day" | "swing-only" | "day-only";
    label: string | null;
    setups: IntradaySetupPayload[];
    emptyMessage: string;
  };
  const setupRenderGroups = useMemo<SetupRenderGroup[]>(() => {
    if (scannerSetupMode === "both") {
      return [
        {
          key: "swing",
          label: "Swing setups (daily cadence)",
          setups: swingRankedSetups,
          emptyMessage: "No swing setups — regime and structure not aligned."
        },
        {
          key: "day",
          label: "Day setups (intraday cadence)",
          setups: dayRankedSetups,
          emptyMessage: "No day setups — intraday confirmation and session timing not aligned."
        }
      ];
    }
    if (scannerSetupMode === "swing") {
      return [
        {
          key: "swing-only",
          label: null,
          setups: swingRankedSetups,
          emptyMessage: setupsEmptyMessage
        }
      ];
    }
    return [
      {
        key: "day-only",
        label: null,
        setups: dayRankedSetups,
        emptyMessage: setupsEmptyMessage
      }
    ];
  }, [scannerSetupMode, swingRankedSetups, dayRankedSetups, setupsEmptyMessage]);

  const confluenceAlertSymbols = useMemo(() => {
    const s = new Set<string>();
    for (const setup of overview.setups) {
      if (setup.is_confluence_alert && setup.symbol) s.add(setup.symbol.trim().toUpperCase());
    }
    return s;
  }, [overview.setups]);

  const gapSymbolsKey = useMemo(
    () => overview.gapIntelligence.map((g) => g.symbol).join(","),
    [overview.gapIntelligence]
  );

  const gapIntelGrouped = useMemo(() => {
    const items = [...overview.gapIntelligence].sort(
      (a, b) => b.gap_quality_score - a.gap_quality_score
    );
    const withCat = items.filter((x) => x.has_catalyst);
    const without = items.filter((x) => !x.has_catalyst);
    return { withCat, without };
  }, [overview.gapIntelligence]);

  const gapIntelBatchMode = scannerSetupMode === "swing" ? "swing" : "day";
  const gapSymbolsForLifecycle = useMemo(
    () => overview.gapIntelligence.map((g) => g.symbol.trim().toUpperCase()).filter(Boolean),
    [overview.gapIntelligence]
  );
  const { snapshots: scannerGapIntelBySymbol } = useScannerGapIntelBatch(
    gapSymbolsForLifecycle,
    gapIntelBatchMode,
    gapSymbolsForLifecycle.length > 0
  );


  useEffect(() => {
    let cancelled = false;
    (async () => {
      const syms = symbolsKey.split(",").filter(Boolean);
      const entries = await Promise.all(syms.map(async (sym) => [sym, await fetchSymbolSnapshot(sym)] as const));
      if (cancelled) return;
      setSnapBySymbol(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [symbolsKey]);

  useEffect(() => {
    let cancelled = false;
    const ny = isoDateInNewYork();
    (async () => {
      const map: Record<string, number | null> = {};
      await Promise.all(
        overview.gapIntelligence.map(async (g) => {
          const bars = await fetchSymbolMinuteBars(g.symbol, ny, ny, 500);
          if (cancelled) return;
          map[g.symbol] = computePmhFromBars(bars, ny);
        })
      );
      if (cancelled) return;
      setPmhBySymbol(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [gapSymbolsKey, overview.gapIntelligence]);

  useEffect(() => {
    const id = window.setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useLayoutEffect(() => {
    if (isUsRegularSessionOpenEt()) {
      nextScanRef.current = Date.now() + 5 * 60 * 1000;
    }
  }, [initialTimestampIso]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!isUsRegularSessionOpenEt()) return;
      if (nextScanRef.current <= 0) {
        nextScanRef.current = Date.now() + 5 * 60 * 1000;
        return;
      }
      if (Date.now() >= nextScanRef.current) {
        nextScanRef.current = Date.now() + 5 * 60 * 1000;
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [router]);

  const onManualRefresh = useCallback(() => {
    startTransition(async () => {
      if (isUsRegularSessionOpenEt()) {
        nextScanRef.current = Date.now() + 5 * 60 * 1000;
      }
      const core = await loadScannerDataWithoutBrief(null, [], {
        parallelDefaultWatchlist: true,
        includeOpportunityDeskUniverse: true,
        maxUniverseSymbols: 150,
        scannerSetupLoadMode: scannerSetupMode,
        intradayBarLimit: 120,
        daySetupsLimit: 10,
        swingSetupsLimit: 6
      });
      if (core.error) {
        setOverview((prev) => ({ ...prev, error: core.error }));
      } else {
        setOverview((prev) => mergeScannerCoreIntoOverview(prev, core));
      }
      router.refresh();
    });
  }, [router, startTransition, scannerSetupMode]);

  const marketOpen = isUsRegularSessionOpenEt();
  const secondsToScan = Math.max(0, Math.ceil((nextScanRef.current - Date.now()) / 1000));
  const scanCountdownLabel = `${Math.floor(secondsToScan / 60)}:${String(secondsToScan % 60).padStart(2, "0")}`;

  const scanSummary = useMemo(() => {
    if (overview.scanSummary) return overview.scanSummary;
    return buildScannerScanSummary({
      scannedAtIso: initialTimestampIso,
      overview,
      nearQualificationSetups: [],
      watchlistProgression: []
    });
  }, [overview, initialTimestampIso]);

  const emptyOverviewInput = useMemo(
    (): EmptyStateOverviewInput => ({
      regimeLabel: overview.regimeLabel,
      spyPct: overview.spyPct,
      qqqPct: overview.qqqPct,
      swingUniverseSymbolCount: overview.swingUniverseSymbolCount,
      gapIntelligenceSnapshotSymbolCount: overview.gapIntelligenceSnapshotSymbolCount,
      marketStatus: { market: marketOpen ? "open" : "closed" },
      progressHints: buildScannerProgressHints({
        nearCount: scanSummary.near_qualification.length,
        watchlist: overview.watchlistStatus ?? scanSummary.watchlist
      })
    }),
    [overview, scanSummary, marketOpen]
  );

  const useCompactColumnEmpty = scanSummary.qualifying.total === 0;
  const showQuietInterpretation = scanSummary.qualifying.total === 0;
  const envDeskMode: "day" | "swing" = scannerSetupMode === "day" ? "day" : "swing";
  const deskMarketEnvironment = useMarketEnvironment(envDeskMode, {
    morningBrief: overview.morningBrief as unknown as Record<string, unknown> | undefined,
    macroRegime: overview.regimeLabel ?? null
  });
  const gapIntelEmpty = overview.gapIntelligence.length === 0;
  const nearReadyCount = scanSummary.near_qualification.length;
  const evaluationTraceDeskFilter: "swing" | "day" | "all" =
    scannerSetupMode === "swing" ? "swing" : scannerSetupMode === "day" ? "day" : "all";
  const [evaluationTrace, setEvaluationTrace] = useState<ScannerEvaluationTraceRow[]>(
    () => overview.evaluationTrace ?? []
  );
  const [scannerSynthesis, setScannerSynthesis] = useState<ScannerSynthesis | null>(
    () => overview.scannerSynthesis ?? null
  );

  useEffect(() => {
    setEvaluationTrace(overview.evaluationTrace ?? []);
    setScannerSynthesis(overview.scannerSynthesis ?? null);
  }, [overview.evaluationTrace, overview.scannerSynthesis]);

  useEffect(() => {
    if (scanSummary.qualifying.total > 0) return;
    if ((overview.evaluationTrace ?? []).length > 0 && overview.scannerSynthesis) return;
    let cancelled = false;
    const mode = evaluationTraceDeskFilter === "all" ? "both" : evaluationTraceDeskFilter;
    void fetchScannerTraceBundleClient(mode, 20)
      .then((bundle) => {
        if (cancelled) return;
        if (bundle.rows.length > 0) setEvaluationTrace(bundle.rows);
        if (bundle.synthesis) setScannerSynthesis(bundle.synthesis);
      })
      .catch(() => {
        /* persisted trace is optional hydration */
      });
    return () => {
      cancelled = true;
    };
  }, [
    scanSummary.qualifying.total,
    overview.evaluationTrace,
    overview.scannerSynthesis,
    evaluationTraceDeskFilter
  ]);

  const setupsPanelTitle =
    scannerSetupMode === "swing"
      ? "Swing setups (daily)"
      : scannerSetupMode === "both"
        ? "Setups · swing + day (two separate desks)"
        : "Day setups (intraday)";

  const panelNewsTradingMode = scannerSetupMode === "day" ? "day" : "swing";
  const activeDeskRejections = useMemo<DeskRejectionSnapshot>(() => {
    if (scannerSetupMode === "swing") return deskRejections.swing;
    if (scannerSetupMode === "day") return deskRejections.day;
    const counts: Record<string, number> = {};
    for (const [reason, count] of Object.entries(deskRejections.swing.rejectionReasonCounts)) {
      counts[reason] = (counts[reason] ?? 0) + count;
    }
    for (const [reason, count] of Object.entries(deskRejections.day.rejectionReasonCounts)) {
      counts[reason] = (counts[reason] ?? 0) + count;
    }
    const seen = new Set<string>();
    const rejectedSamples = [...deskRejections.swing.rejectedSamples, ...deskRejections.day.rejectedSamples].filter(
      (row) => {
        const key = `${row.symbol}::${row.reason}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }
    );
    const retainedPool = [...deskRejections.swing.retainedPool, ...deskRejections.day.retainedPool];
    const survivorLimitUsed = Math.max(
      deskRejections.swing.survivorLimitUsed,
      deskRejections.day.survivorLimitUsed,
      retainedPool.length
    );
    return { rejectionReasonCounts: counts, rejectedSamples, retainedPool, survivorLimitUsed };
  }, [deskRejections, scannerSetupMode]);
  const retainedPoolPageSize = 25;
  const retainedPoolTotal = activeDeskRejections.retainedPool.length;
  const retainedPoolPages = Math.max(1, Math.ceil(retainedPoolTotal / retainedPoolPageSize));
  const safeRetainedPoolPage = Math.min(retainedPoolPage, retainedPoolPages);
  const retainedPoolRows = useMemo(() => {
    const start = (safeRetainedPoolPage - 1) * retainedPoolPageSize;
    return activeDeskRejections.retainedPool.slice(start, start + retainedPoolPageSize);
  }, [activeDeskRejections.retainedPool, safeRetainedPoolPage]);
  const retainedPoolNames = useSymbolNames(retainedPoolRows.map((row) => row.symbol));
  useEffect(() => {
    if (retainedPoolPage !== safeRetainedPoolPage) {
      setRetainedPoolPage(safeRetainedPoolPage);
    }
  }, [retainedPoolPage, safeRetainedPoolPage]);
  const whyMissingSuggestedSymbols = useMemo(() => {
    return [
      ...new Set([
        ...overview.gapIntelligence.map((g) => g.symbol.trim().toUpperCase()),
        ...overview.setups.map((s) => s.symbol.trim().toUpperCase()),
        ...scanSummary.near_qualification.map((n) => n.symbol.trim().toUpperCase())
      ])
    ]
      .filter(Boolean)
      .slice(0, 40);
  }, [overview.gapIntelligence, overview.setups, scanSummary.near_qualification]);
  const handleExplainMissingFromPotential = useCallback((symbol: string) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    setShowAdvancedScannerPanels(true);
    setWhyMissingPrefillSymbol(sym);
    const target = document.getElementById("scanner-why-missing-panel");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);
  /**
   * Trading mode used to enrich Evidence-card composite reads from this surface.
   * The resolution rule lives in `@/lib/scanner-mode-resolution` as a single
   * documented source of truth — keep it there, not inline here, so future
   * surfaces (Day Desk inline evidence, additional engines, etc.) can reuse the
   * same contract without copy-pasting a ternary that drifts. The rule mirrors
   * `panelNewsTradingMode` above so news lookback + composite engine stay in
   * lockstep on every Evidence-modal open.
   */
  const evidenceTradingMode = resolveEvidenceTradingMode(scannerSetupMode);

  const earningsBadgeFor = (symbol: string): { label: string; tip: string } | null => {
    const event = earningsBySymbol[symbol.toUpperCase()];
    if (!event) return null;
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 10);
    if (event.report_date !== today && event.report_date !== tomorrow) return null;
    const when = event.report_date === today ? "today" : "tomorrow";
    const timing =
      event.report_time === "before_market"
        ? "before market"
        : event.report_time === "after_market"
          ? "after market"
          : "during market";
    return {
      label: "📊 Earnings",
      tip: `This stock reports earnings ${when} ${timing}. Gaps and setups around earnings carry higher risk and reward.`
    };
  };
  const earningsRiskFor = (symbol: string): { daysUntil: number; reportTime: EarningsEvent["report_time"] } | null => {
    const event = earningsBySymbol[symbol.toUpperCase()];
    if (!event) return null;
    const today = new Date().toISOString().slice(0, 10);
    const dayDelta = Math.floor(
      (Date.parse(`${event.report_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
    );
    if (dayDelta < 0 || dayDelta > 3) return null;
    return { daysUntil: dayDelta, reportTime: event.report_time };
  };

  /**
   * Publish a whitelisted, qualitative summary of what is currently on the scanner so the
   * STOCVEST Assistant can answer in terms of the user's screen. Only fields enumerated in
   * `AssistantPageContext` survive the server-side whitelist in `serialize_page_context`;
   * unknown keys are dropped. Scores are bucketed (no raw numerics) to stay aligned with
   * the assistant's "qualitative language" rule.
   */
  const assistantContext = useMemo<AssistantPageContext>(() => {
    const topSetups: AssistantScannerSetupSummary[] = rankedSetups.slice(0, 3).map((setup) => {
      const strengthPct = topSignalStrengthPercent(setup);
      const strength_bucket: AssistantScannerSetupSummary["strength_bucket"] =
        strengthPct >= 70 ? "strong" : strengthPct >= 50 ? "moderate" : "weak";
      const patternRaw = setup.triggers?.[0] ?? "";
      return {
        symbol: setup.symbol.trim().toUpperCase(),
        direction: isLongDirection(setup.direction) ? "long" : "short",
        strength_bucket,
        confluence: setup.is_confluence_alert === true,
        orb_expired: patternRaw.toLowerCase().startsWith("orb_") && isAfterOrbCloseEt()
      };
    });

    const topGapsWithCatalyst: AssistantScannerGapSummary[] = gapIntelGrouped.withCat
      .slice(0, 3)
      .map((item) => {
        const quality_bucket: AssistantScannerGapSummary["quality_bucket"] =
          item.gap_quality_score >= 80 ? "high" : item.gap_quality_score >= 60 ? "medium" : "low";
        const sentRaw = (item.catalyst?.sentiment ?? "").toLowerCase();
        const catalyst_sentiment: AssistantScannerGapSummary["catalyst_sentiment"] | undefined =
          sentRaw === "bullish" || sentRaw === "bearish" || sentRaw === "neutral" ? sentRaw : undefined;
        const catRaw = (item.catalyst?.category ?? "").trim().toLowerCase();
        return {
          symbol: item.symbol.trim().toUpperCase(),
          gap_direction: item.gap_pct >= 0 ? "up" : "down",
          quality_bucket,
          catalyst_category: catRaw || undefined,
          catalyst_sentiment
        };
      });

    return {
      page: "dashboard/scanner",
      trading_mode: scannerSetupMode === "swing" ? "swing" : scannerSetupMode === "day" ? "day" : undefined,
      market_regime: overview.regimeLabel?.trim() || undefined,
      scanner_focus: scannerSetupMode,
      market_open: marketOpen,
      gap_with_catalyst_count: gapIntelGrouped.withCat.length,
      gap_without_catalyst_count: gapIntelGrouped.without.length,
      ranked_setups_count: rankedSetups.length,
      top_setups: topSetups,
      top_gaps_with_catalyst: topGapsWithCatalyst,
      swing_setups_suppressed: showSwingScanContextBanner,
      setups_empty_message: rankedSetups.length === 0 ? setupsEmptyMessage : undefined
    };
  }, [
    scannerSetupMode,
    overview.regimeLabel,
    marketOpen,
    gapIntelGrouped.withCat,
    gapIntelGrouped.without.length,
    rankedSetups,
    showSwingScanContextBanner,
    setupsEmptyMessage
  ]);

  const evidenceAssistantContext = useMemo<AssistantPageContext | null>(() => {
    if (!evidenceOpen) return null;
    if (!evidence) {
      const sym = (evidenceLoadingSymbol ?? "").trim().toUpperCase();
      if (!sym) return null;
      return {
        page: "dashboard/scanner",
        symbol: sym,
        analysis_status: "loading",
        trading_mode:
          scannerSetupMode === "swing" ? "swing" : scannerSetupMode === "day" ? "day" : undefined
      };
    }
    const tradingMode =
      evidence.compositeMode ??
      (scannerSetupMode === "swing" ? "swing" : scannerSetupMode === "day" ? "day" : "swing");
    const sym = evidence.symbol.trim().toUpperCase();
    const gapSnap = sym ? (scannerGapIntelBySymbol[sym] ?? null) : null;
    return (
      buildEvidenceAssistantContext({
        evidence,
        tradingMode,
        page: "dashboard/scanner",
        gapIntelSnapshot: gapSnap,
        analysisStatus: evidence.insight ? "loaded" : evidenceLoading ? "loading" : undefined
      }) ?? null
    );
  }, [
    evidenceOpen,
    evidence,
    evidenceLoading,
    evidenceLoadingSymbol,
    scannerSetupMode,
    scannerGapIntelBySymbol
  ]);

  const publishedAssistantContext = evidenceAssistantContext ?? assistantContext;
  usePublishAssistantContext(publishedAssistantContext);

  const openGapEvidence = useCallback(
    async (item: GapIntelligenceItem) => {
      const sym = item.symbol.trim().toUpperCase();
      // Per-row mode resolution (B30 Phase 4). In `scannerSetupMode === "both"`
      // view, the classifier verdict on this specific gap row picks the
      // engine; explicit "swing" / "day" scanner modes always override the
      // verdict. See `resolveGapCardTradingMode` for the full rule.
      const gapCardMode = resolveGapCardTradingMode(scannerSetupMode, item.mode_best_fit);
      setEvidenceLoading(true);
      setEvidenceLoadingSymbol(sym);
      setEvidence(null);
      setEvidenceOpen(true);
      try {
        let symbolNewsArticles: Awaited<ReturnType<typeof fetchSymbolNews>> = [];
        try {
          symbolNewsArticles = await fetchSymbolNews(item.symbol, 10, {
            newsTradingMode: panelNewsTradingMode
          });
        } catch {
          symbolNewsArticles = [];
        }
        const risk = earningsRiskFor(item.symbol);
        const s = (await fetchSymbolSnapshot(sym)) ?? undefined;
        const base = buildEvidenceFromSetup(gapSyntheticSetup(item), s, {
          symbolNewsArticles,
          earningsRiskDays: risk?.daysUntil,
          earningsReportTime: risk?.reportTime
        });
        setEvidence(await enrichEvidenceWithComposite(base, gapCardMode));
      } finally {
        setEvidenceLoading(false);
        setEvidenceLoadingSymbol(null);
      }
    },
    [earningsBySymbol, panelNewsTradingMode, scannerSetupMode]
  );

  const gapCardDeps: GapIntelCardDeps = {
    colors,
    overview,
    scannerSetupMode,
    dayTradingSurfaces,
    evidenceLoading,
    snapBySymbol,
    pmhBySymbol,
    scannerGapIntelBySymbol,
    confluenceAlertSymbols,
    earningsBadgeFor,
    openGapNews,
    openGapEvidence,
    goToPortfolioOrder
  };

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      {overview.error ? (
        <div
          role="alert"
          style={{
            borderRadius: borderRadius.lg,
            border: `1px solid ${colors.caution}`,
            background: `color-mix(in srgb, ${colors.caution} 12%, ${colors.surface})`,
            padding: `${spacing[3]} ${spacing[4]}`,
            color: colors.text,
            fontSize: typography.scale.sm,
            lineHeight: 1.5
          }}
        >
          <strong style={{ display: "block", marginBottom: spacing[1] }}>Scanner data could not load</strong>
          {overview.error}
          <div style={{ marginTop: spacing[2] }}>
            <button
              type="button"
              onClick={onManualRefresh}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                background: colors.surface,
                color: colors.text,
                padding: `${spacing[1]} ${spacing[3]}`,
                fontSize: typography.scale.xs,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      <ScannerScanResultHero
        summary={scanSummary}
        synthesis={scannerSynthesis}
        isRefreshing={isPending}
        onRefresh={onManualRefresh}
        hideWatchlistStrip={showQuietInterpretation}
        nextScanLabel={marketOpen ? scanCountdownLabel : null}
      />
      <div data-testid="scanner-view-mode-toggle" style={{ display: "flex", justifyContent: "flex-end", marginTop: -spacing[2] }}>
        <button
          type="button"
          onClick={() => setShowAdvancedScannerPanels((v) => !v)}
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            background: showAdvancedScannerPanels ? colors.surfaceMuted : colors.surface,
            color: colors.text,
            padding: `${spacing[1]} ${spacing[2]}`,
            minHeight: 44,
            fontSize: typography.scale.xs,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          {showAdvancedScannerPanels ? "Hide details" : "Show details"}
        </button>
      </div>
      {!showQuietInterpretation && showAdvancedScannerPanels ? <ScannerOutcomeCards summary={scanSummary} /> : null}
      <ScannerMoverLanes
        gapItems={overview.gapIntelligence}
        setups={overview.setups}
        nearQualification={scanSummary.near_qualification}
        evaluationTrace={evaluationTrace}
        compact={false}
        onExplainMissingSymbol={handleExplainMissingFromPotential}
      />
      {showAdvancedScannerPanels ? (
        <ScannerWhyMissingPanel
          rejectedSamples={activeDeskRejections.rejectedSamples}
          rejectionReasonCounts={activeDeskRejections.rejectionReasonCounts}
          suggestedSymbols={whyMissingSuggestedSymbols}
          prefillSymbol={whyMissingPrefillSymbol}
          showSymbolSuggestions={false}
        />
      ) : null}
      {showAdvancedScannerPanels && activeDeskRejections.survivorLimitUsed > 0 ? (
        <section
          data-testid="scanner-retained-pool-section"
          style={{
            borderRadius: borderRadius.xl,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            padding: spacing[4],
            display: "grid",
            gap: spacing[2]
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing[2],
              flexWrap: "wrap"
            }}
          >
            <div>
              <p
                style={{
                  margin: 0,
                  fontSize: typography.scale.xs,
                  color: colors.textMuted,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 700
                }}
              >
                Retained pool
              </p>
              <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.sm, color: colors.text }}>
                {activeDeskRejections.survivorLimitUsed} symbols passed the hard filters this cycle.
              </p>
              <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
                Score = pre-setup rank score (gap quality + liquidity bias). Higher means stronger discovery priority.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRetainedPool((v) => !v)}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.md,
                background: colors.surfaceMuted,
                color: colors.text,
                padding: `${spacing[1]} ${spacing[2]}`,
                minHeight: 44,
                fontSize: typography.scale.xs,
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              {showRetainedPool ? "Hide retained list" : `Browse retained list (${retainedPoolTotal})`}
            </button>
          </div>
          {showRetainedPool ? (
            <>
              <div style={{ overflowX: "auto", margin: `0 -${spacing[1]}` }}>
                <div style={{ display: "grid", gap: spacing[1], minWidth: 520, padding: `0 ${spacing[1]}` }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(7rem,1.3fr) minmax(4.5rem,0.8fr) minmax(4rem,0.8fr) minmax(5rem,1fr)",
                    gap: spacing[2],
                    padding: `${spacing[1]} ${spacing[2]}`,
                    color: colors.textMuted,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase"
                  }}
                >
                  <span>Symbol</span>
                  <span>Gap %</span>
                  <span>Rank</span>
                  <span>Score</span>
                </div>
                {retainedPoolRows.map((row) => (
                  <div
                    key={`${row.desk}-${row.symbol}-${row.rank_position ?? row.rank_score}`}
                    style={{
                      borderRadius: borderRadius.md,
                      border: `1px solid ${colors.border}`,
                      background: colors.surfaceMuted
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRetainedRowKey((current) => {
                          const rowKey = `${row.desk}-${row.symbol}-${row.rank_position ?? row.rank_score}`;
                          return current === rowKey ? null : rowKey;
                        })
                      }
                      aria-expanded={
                        expandedRetainedRowKey === `${row.desk}-${row.symbol}-${row.rank_position ?? row.rank_score}`
                      }
                      style={{
                        width: "100%",
                        border: "none",
                        background: "transparent",
                        display: "grid",
                        gridTemplateColumns: "minmax(7rem,1.3fr) minmax(4.5rem,0.8fr) minmax(4rem,0.8fr) minmax(5rem,1fr)",
                        gap: spacing[2],
                        padding: `${spacing[1]} ${spacing[2]}`,
                        fontSize: typography.scale.xs,
                        alignItems: "center",
                        cursor: "pointer",
                        textAlign: "left"
                      }}
                    >
                      <span style={{ color: colors.text, fontWeight: 700, minWidth: 0 }}>
                        <span style={{ display: "inline-flex", alignItems: "baseline", gap: spacing[1], minWidth: 0 }}>
                          {row.symbol}
                          {scannerSetupMode === "both" ? (
                            <span style={{ color: colors.textMuted, fontWeight: 500 }}>{row.desk}</span>
                          ) : null}
                        </span>
                        {retainedPoolNames[row.symbol] ? (
                          <span
                            title={retainedPoolNames[row.symbol]}
                            style={{
                              display: "block",
                              color: colors.textMuted,
                              fontWeight: 400,
                              fontSize: 11,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}
                          >
                            {retainedPoolNames[row.symbol]}
                          </span>
                        ) : null}
                      </span>
                      <span style={{ color: colors.textMuted }}>{Number(row.gap_percent ?? 0).toFixed(2)}</span>
                      <span style={{ color: colors.textMuted }}>
                        {row.rank_position && row.rank_position > 0 ? `#${row.rank_position}` : "n/a"}
                      </span>
                      <span style={{ color: colors.textMuted }}>{Number(row.rank_score ?? 0).toFixed(1)}</span>
                    </button>
                    {expandedRetainedRowKey === `${row.desk}-${row.symbol}-${row.rank_position ?? row.rank_score}` ? (
                      <div
                        style={{
                          borderTop: `1px solid ${colors.border}`,
                          padding: `${spacing[2]} ${spacing[2]}`,
                          display: "grid",
                          gap: spacing[1]
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))",
                            gap: spacing[1],
                            fontSize: typography.scale.xs,
                            color: colors.textMuted
                          }}
                        >
                          <span>Direction: {row.direction === "down" ? "Down gap" : "Up gap"}</span>
                          <span>
                            Session price:{" "}
                            {row.session_price && Number.isFinite(row.session_price)
                              ? `$${row.session_price.toFixed(2)}`
                              : "n/a"}
                          </span>
                          <span>
                            Day volume:{" "}
                            {row.day_volume && Number.isFinite(row.day_volume)
                              ? row.day_volume.toLocaleString()
                              : "n/a"}
                          </span>
                          <span>Desk: {row.desk}</span>
                        </div>
                        <div>
                          <Link
                            href={scannerToSignalsHref(row.symbol, row.desk === "day" ? "day" : "swing")}
                            style={{
                              color: colors.accent,
                              fontSize: typography.scale.xs,
                              fontWeight: 600,
                              textDecoration: "none"
                            }}
                          >
                            Open signal details {"->"}
                          </Link>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
                </div>
              </div>
              {retainedPoolPages > 1 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: spacing[2],
                    marginTop: spacing[1]
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setRetainedPoolPage((p) => Math.max(1, p - 1))}
                    disabled={safeRetainedPoolPage <= 1}
                    style={{
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.md,
                      background: colors.surfaceMuted,
                      color: colors.text,
                      padding: `${spacing[1]} ${spacing[2]}`,
                      minHeight: 44,
                      fontSize: typography.scale.xs,
                      fontWeight: 600,
                      cursor: safeRetainedPoolPage <= 1 ? "not-allowed" : "pointer",
                      opacity: safeRetainedPoolPage <= 1 ? 0.6 : 1
                    }}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
                    Page {safeRetainedPoolPage} of {retainedPoolPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRetainedPoolPage((p) => Math.min(retainedPoolPages, p + 1))}
                    disabled={safeRetainedPoolPage >= retainedPoolPages}
                    style={{
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.md,
                      background: colors.surfaceMuted,
                      color: colors.text,
                      padding: `${spacing[1]} ${spacing[2]}`,
                      minHeight: 44,
                      fontSize: typography.scale.xs,
                      fontWeight: 600,
                      cursor: safeRetainedPoolPage >= retainedPoolPages ? "not-allowed" : "pointer",
                      opacity: safeRetainedPoolPage >= retainedPoolPages ? 0.6 : 1
                    }}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      {!showQuietInterpretation && showAdvancedScannerPanels ? (
        <ScannerNearQualificationSection
          nearQualification={scanSummary.near_qualification}
          watchlistProgression={scanSummary.watchlist_progression}
        />
      ) : null}
      {!showQuietInterpretation && showAdvancedScannerPanels ? (
        <ScannerQuietLeadersSection scannerMode={scannerSetupMode === "both" ? "swing" : scannerSetupMode} />
      ) : null}
      {showQuietInterpretation ? (
        <ScannerQuietDesk
          summary={scanSummary}
          synthesis={scannerSynthesis}
          deskFilter={evaluationTraceDeskFilter}
          compact={!showAdvancedScannerPanels}
        />
      ) : null}

      {deskMarketEnvironment ? (
        <MarketEnvironmentStrip environment={deskMarketEnvironment} testId="scanner-environment-strip" />
      ) : null}

      {dayTradingSurfaces ? (
        <DeskModeTabNav
          value={scannerSetupMode}
          onChange={persistScannerMode}
          modes={["swing", "day", "both"] as const}
          ariaLabel="Scanner setup source"
          testIdPrefix="scanner-mode-tab"
          showCadence
          className="mt-0"
        />
      ) : (
        <div
          data-testid="scanner-swing-pro-plan-banner"
          className={surfaceGlowClassName}
          style={{
            marginTop: 0,
            borderRadius: borderRadius.lg,
            border: "1px solid color-mix(in srgb, rgba(168,85,247,0.45) 55%, rgba(148,163,184,0.35))",
            background: "rgba(168,85,247,0.08)",
            padding: `${spacing[3]} ${spacing[4]}`
          }}
        >
          <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 700, color: "#A855F7" }}>
            Swing scanner (your plan)
          </p>
          <p style={{ margin: `${spacing[2]} 0 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
            {`Day and combined "both" views are not included on Swing Pro. This page shows multi-day swing setups only.`}
          </p>
        </div>
      )}

      {showSwingScanContextBanner ? (
        <div
          role="note"
          style={{
            borderRadius: borderRadius.lg,
            border: `1px solid ${colors.border}`,
            background: `color-mix(in srgb, ${colors.textMuted} 8%, ${colors.surface})`,
            padding: `${spacing[2]} ${spacing[3]}`,
            fontSize: typography.scale.sm,
            color: colors.textMuted,
            lineHeight: 1.5
          }}
        >
          <span style={{ color: colors.text, fontWeight: 600 }}>Scan focus: </span>
          Early volatility & news dislocations — swing candidates require stabilization.
        </div>
      ) : null}

      {showQuietInterpretation && showAdvancedScannerPanels ? (
        <p
          data-testid="scanner-why-nothing-qualified"
          style={{
            margin: 0,
            fontSize: typography.scale.xs,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: colors.textMuted
          }}
        >
          Why nothing qualified
        </p>
      ) : null}

      <div className="scanner-grid grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section
          data-testid="scanner-gap-intelligence-section"
          data-empty={gapIntelEmpty ? "true" : "false"}
          className={gapIntelEmpty ? "min-w-0" : `min-w-0 ${surfaceGlowClassName}`}
          style={{
            background: gapIntelEmpty
              ? `color-mix(in srgb, ${colors.textMuted} 5%, ${colors.surface})`
              : colors.surface,
            border: gapIntelEmpty
              ? `1px dashed color-mix(in srgb, ${colors.border} 65%, transparent)`
              : `1px solid ${colors.border}`,
            borderRadius: borderRadius.xl,
            padding: gapIntelEmpty ? spacing[3] : spacing[4],
            opacity: gapIntelEmpty ? 0.94 : 1
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: spacing[2],
              marginBottom: spacing[2]
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: gapIntelEmpty ? typography.scale.base : undefined,
                  fontWeight: gapIntelEmpty ? 600 : undefined,
                  color: gapIntelEmpty ? colors.textMuted : colors.text
                }}
              >
                Gap Intelligence
                {gapIntelEmpty ? (
                  <span
                    style={{
                      marginLeft: spacing[2],
                      fontSize: typography.scale.xs,
                      fontWeight: 600,
                      color: colors.textMuted
                    }}
                  >
                    (0 today)
                  </span>
                ) : null}
              </h3>
              <p
                style={{
                  margin: `${spacing[1]} 0 0`,
                  fontSize: typography.scale.xs,
                  color: colors.textMuted,
                  lineHeight: 1.45,
                  maxWidth: "42rem"
                }}
              >
                {gapIntelEmpty
                  ? GAP_INTEL_EMPTY_CONTEXT
                  : "Extreme moves to monitor — not swing entries on the gap."}
              </p>
              {!gapIntelEmpty ? (
                <p
                  data-testid="scanner-gap-active-guidance"
                  style={{
                    margin: `${spacing[1]} 0 0`,
                    fontSize: typography.scale.xs,
                    fontWeight: 600,
                    color: colors.caution,
                    lineHeight: 1.45,
                    maxWidth: "42rem"
                  }}
                >
                  {GAP_INTEL_ACTIVE_GUIDANCE}
                </p>
              ) : null}
            </div>
            <InfoTip text={GAP_INTELLIGENCE_TIP} label="About gap intelligence" />
          </div>
          {overview.gapIntelligenceUniverseNote ? (
            <p
              role="status"
              data-testid="scanner-gap-universe-note"
              style={{
                margin: `0 0 ${spacing[2]}`,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                lineHeight: typography.lineHeight.normal
              }}
            >
              {overview.gapIntelligenceUniverseNote}
            </p>
          ) : null}
          {overview.gapIntelligence.length > 0 ? (
            <p
              style={{
                margin: `0 0 ${spacing[2]}`,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                lineHeight: 1.45
              }}
            >
              Overnight discovery for every desk — Day/Swing filters apply to actionable setups below, not gaps.
            </p>
          ) : null}
          <div
            style={{
              display: "grid",
              gap: spacing[3],
              maxHeight: "min(70vh, 820px)",
              overflowY: "auto",
              paddingRight: spacing[1]
            }}
          >
            {overview.gapIntelligence.length === 0 ? (
              // Gap Intelligence has its OWN empty-state copy — the
              // gap scanner is gated on magnitude + volume backing,
              // not on the same regime/structure gates as the setups
              // column. Reusing the swing-setups copy here made both
              // side-by-side columns show identical text, which read
              // as a bug. `compact` drops the cross-link nav so this
              // card doesn't dominate the half-width column.
              //
              // Mode mapping: on the Day tab we render the day-side
              // variant (intraday-survival framing, ORB/RVOL vocab).
              // On Swing and Both we render the swing-side variant
              // since the gap rail visually lives in the swing column
              // and the day desk surfaces gap reads through its own
              // setup rows.
              <ScannerEmptyStateCard
                context={buildGapIntelEmptyStateContext(
                  {
                    regimeLabel: overview.regimeLabel,
                    spyPct: overview.spyPct,
                    qqqPct: overview.qqqPct,
                    swingUniverseSymbolCount: overview.swingUniverseSymbolCount,
                    gapIntelligenceSnapshotSymbolCount: overview.gapIntelligenceSnapshotSymbolCount
                  },
                  scannerSetupMode === "day" ? "day" : "swing"
                )}
                compact={useCompactColumnEmpty}
                interpretive={showQuietInterpretation}
                interpretiveOverview={emptyOverviewInput}
                deemphasized={showQuietInterpretation}
                testId="scanner-gap-empty-state"
              />
            ) : (
              <>
                {gapIntelGrouped.withCat.map((item, idx) => (
                  <GapIntelCard
                    key={`${item.symbol}-c-${idx}`}
                    item={item}
                    idx={idx}
                    noCatSection={false}
                    deps={gapCardDeps}
                  />
                ))}
                {gapIntelGrouped.withCat.length > 0 && gapIntelGrouped.without.length > 0 ? (
                  <p
                    style={{
                      margin: 0,
                      textAlign: "center",
                      color: colors.textMuted,
                      fontSize: typography.scale.xs,
                      letterSpacing: 0.04
                    }}
                  >
                    —— Catalyst confirmed —— · —— No catalyst found ——
                  </p>
                ) : null}
                {gapIntelGrouped.without.map((item, idx) => (
                  <GapIntelCard
                    key={`${item.symbol}-nc-${idx}`}
                    item={item}
                    idx={idx + gapIntelGrouped.withCat.length}
                    noCatSection={true}
                    deps={gapCardDeps}
                  />
                ))}
              </>
            )}
          </div>
        </section>

        <section
          id="scanner-setups-section"
          data-testid="scanner-setups-section"
          data-quiet-secondary={showQuietInterpretation ? "true" : "false"}
          className={showQuietInterpretation ? "min-w-0" : `min-w-0 ${surfaceGlowClassName}`}
          style={{
            background: showQuietInterpretation
              ? `color-mix(in srgb, ${colors.textMuted} 4%, ${colors.surface})`
              : colors.surface,
            border: showQuietInterpretation
              ? `1px solid color-mix(in srgb, ${colors.border} 75%, transparent)`
              : `1px solid ${colors.border}`,
            borderRadius: borderRadius.xl,
            padding: spacing[4]
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2], marginBottom: spacing[2] }}>
            <h3 style={{ margin: 0 }}>{setupsPanelTitle}</h3>
            <InfoTip text={INTRADAY_SETUPS_TIP} label="About ranked setups" />
          </div>
          <div
            style={{
              display: "grid",
              gap: spacing[3],
              maxHeight: "min(70vh, 820px)",
              overflowY: "auto",
              paddingRight: spacing[1]
            }}
          >
            {setupRenderGroups.map((group) => (
              <Fragment key={`setup-group-${group.key}`}>
                {group.label ? (
                  <h4
                    style={{
                      margin: 0,
                      fontSize: typography.scale.xs,
                      fontWeight: 700,
                      color: colors.textMuted,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase"
                    }}
                  >
                    {group.label}
                  </h4>
                ) : null}
                {group.setups.length === 0 ? (
                  // Rich empty state per render group — swing group
                  // uses the swing-side context, day group uses the
                  // day-side context, so the user gets mode-appropriate
                  // re-enable copy in the `Both` view where both groups
                  // render side-by-side. Full width (NOT compact) here
                  // because the setups column is the primary surface
                  // and the cross-link nav belongs on the dominant
                  // empty state.
                  (() => {
                    const isDayGroup = group.key === "day" || group.key === "day-only";
                    const context = isDayGroup
                      ? buildDayEmptyStateContext(emptyOverviewInput)
                      : buildSwingEmptyStateContext(emptyOverviewInput);
                    return (
                      <ScannerEmptyStateCard
                        context={context}
                        compact={useCompactColumnEmpty}
                        interpretive={showQuietInterpretation}
                        interpretiveOverview={emptyOverviewInput}
                        nearReadyCount={nearReadyCount}
                        secondaryPanel={showQuietInterpretation}
                        testId={`scanner-setups-empty-state-${group.key}`}
                      />
                    );
                  })()
                ) : (
                  group.setups.map((setup, idx) => {
                /**
                 * Per-row trading mode resolved from the render-group key (see
                 * `resolveSetupRowTradingMode`) so swing-group rows always open the
                 * swing engine and day-group rows always open the day engine even in
                 * the merged `scannerSetupMode === "both"` view. Top-level
                 * `evidenceTradingMode` is the defensive fallback if a future group
                 * key doesn't start with `swing`/`day`.
                 */
                const groupTradingMode = resolveSetupRowTradingMode(group.key, evidenceTradingMode);
                const snap = snapBySymbol[setup.symbol] ?? null;
                const zone = entryZoneFromSnapshot(snap);
                const vwap = snap?.day_vwap;
                const dv = dayVolBySymbol.get(setup.symbol);
                const volNum = snap?.day_volume ?? dv ?? null;
                const ratio =
                  volNum != null && gapMeanVolume > 0
                    ? Math.min(3.5, Math.max(0.35, volNum / gapMeanVolume))
                    : 0.85 + setup.score * 2.2;
                const fillPct = Math.min(100, (ratio / 3.5) * 100);
                const d = setup.direction.toLowerCase();
                const up = d === "long" || d === "bullish";
                const patternRaw = setup.triggers?.[0] ?? "";
                const patternLabel = setupPatternLabel(setup.triggers);
                const expiryNote = setupExpiryNote(patternRaw);
                const orbExpired = patternRaw.toLowerCase().startsWith("orb_") && isAfterOrbCloseEt();
                const longOrShort = isLongDirection(setup.direction) ? "Long" : "Short";
                const isConfluence = setup.is_confluence_alert === true;
                const nConf =
                  typeof setup.n_confirming === "number" ? setup.n_confirming : (setup.confirming_signals?.length ?? 0);
                const nConfl =
                  typeof setup.n_conflicting === "number" ? setup.n_conflicting : (setup.conflicting_signals?.length ?? 0);
                const confirming = setup.confirming_signals ?? [];
                const conflicting = setup.conflicting_signals ?? [];
                const histNote = (setup.historical_note ?? "").trim();

                return (
                  <motion.article
                    key={`${setup.symbol}-${setup.timestamp_iso}-${idx}`}
                    className={surfaceGlowClassName}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    style={{
                      background: isConfluence ? "rgba(245, 197, 66, 0.04)" : colors.surface,
                      border: `1px solid ${colors.border}`,
                      ...(isConfluence ? { borderLeft: "3px solid #f5c542" } : {}),
                      borderRadius: borderRadius.lg,
                      padding: spacing[3],
                      display: "grid",
                      gap: spacing[2],
                      position: "relative",
                      paddingBottom: spacing[5],
                      opacity: orbExpired ? 0.7 : 1,
                      transition: "opacity 0.15s ease"
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: spacing[2],
                          flexWrap: "wrap",
                          minWidth: 0
                        }}
                      >
                        <strong style={{ fontSize: typography.scale.base }}>{setup.symbol}</strong>
                        {setup.company_name ? (
                          <span style={{ color: colors.textMuted, fontSize: "13px" }}>{setup.company_name}</span>
                        ) : null}
                      </div>
                      <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>{patternLabel}</span>
                      {setup.scanner_mode === "swing_daily" ? (
                        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs, lineHeight: 1.45 }}>
                          {typeof setup.pattern_maturity_days === "number"
                            ? `Maturity ${setup.pattern_maturity_days} sessions · `
                            : ""}
                          {setup.ema_daily_crossovers?.length ? `EMA ${setup.ema_daily_crossovers.join(", ")}` : ""}
                          {typeof setup.weekly_rsi === "number"
                            ? `${setup.ema_daily_crossovers?.length ? " · " : ""}Weekly RSI ${setup.weekly_rsi.toFixed(0)}`
                            : ""}
                          {setup.weekly_rsi_recovery ? " · RSI recovery" : ""}
                        </span>
                      ) : null}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                          width: "100%"
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                            flex: 1,
                            minWidth: 0
                          }}
                        >
                          {(() => {
                            const b = earningsBadgeFor(setup.symbol);
                            if (!b) return null;
                            return (
                              <span
                                style={{
                                  borderRadius: borderRadius.full,
                                  padding: "2px 8px",
                                  background: "rgba(245,158,11,.18)",
                                  color: colors.caution,
                                  fontSize: typography.scale.xs,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4
                                }}
                              >
                                {b.label}
                                <InfoTip text={b.tip} label="Earnings risk" />
                              </span>
                            );
                          })()}
                          <span
                            style={{
                              borderRadius: borderRadius.full,
                              padding: "2px 8px",
                              background: isLongDirection(setup.direction) ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.15)",
                              color: isLongDirection(setup.direction) ? colors.bullish : colors.bearish,
                              fontSize: typography.scale.xs,
                              fontWeight: 600
                            }}
                          >
                            {longOrShort}
                          </span>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: typography.scale.sm,
                              color: colors.textMuted,
                              fontFamily: MONO
                            }}
                          >
                            {topSignalStrengthPercent(setup)}%
                            <InfoTip text={CONFIDENCE_PERCENT_TIP} label="About signal strength" />
                          </span>
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
                          {isConfluence ? <span style={CONFLUENCE_BADGE_STYLE}>CONFLUENCE</span> : null}
                          {orbExpired ? (
                            <span
                              style={{
                                fontSize: typography.scale.xs,
                                fontWeight: 700,
                                color: colors.caution,
                                background: "rgba(245,158,11,.2)",
                                borderRadius: borderRadius.md,
                                padding: "2px 8px"
                              }}
                            >
                              ORB EXPIRED
                            </span>
                          ) : null}
                        </div>
                      </div>
                      {isConfluence ? (
                        <>
                          <p
                            style={{
                              margin: 0,
                              fontSize: "11px",
                              color: "var(--color-text-tertiary)"
                            }}
                          >
                            {nConf} signals confirming · {nConfl} conflicting
                          </p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            {confirming.slice(0, 3).map((c, i) => (
                              <span
                                key={`cf-${i}-${c.label}`}
                                style={{
                                  fontSize: "10px",
                                  border: "0.5px solid var(--color-border-tertiary)",
                                  borderRadius: "4px",
                                  padding: "2px 8px",
                                  color: "var(--color-text-secondary)",
                                  background: "var(--color-background-secondary)"
                                }}
                              >
                                {c.label}
                              </span>
                            ))}
                            {nConf > 3 ? (
                              <span
                                style={{
                                  fontSize: "10px",
                                  color: "var(--color-text-tertiary)",
                                  padding: "2px 4px"
                                }}
                              >
                                + {nConf - 3} more
                              </span>
                            ) : null}
                          </div>
                          {nConfl >= 2 && conflicting[0]?.label ? (
                            <p
                              style={{
                                margin: 0,
                                fontSize: "11px",
                                color: "var(--color-text-warning)"
                              }}
                            >
                              ! {nConfl} conflicting: {conflicting[0].label}
                            </p>
                          ) : null}
                          {histNote ? (
                            <p
                              style={{
                                margin: 0,
                                fontSize: "11px",
                                fontStyle: "italic",
                                color: "var(--color-text-tertiary)"
                              }}
                            >
                              {histNote}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                      {orbExpired ? (
                        <p
                          style={{
                            margin: 0,
                            fontSize: "11px",
                            color: "var(--color-text-tertiary)",
                            fontStyle: "italic"
                          }}
                        >
                          Signal fired at {formatSignalFiredTimeEt(setup.timestamp_iso) || "—"} — window closed 10:00 AM ET
                        </p>
                      ) : null}
                    </div>
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
                      Vol: {volNum != null ? `${formatVolumeShort(volNum)} (${ratio.toFixed(1)}x avg)` : `${ratio.toFixed(1)}x avg`}
                      {typeof vwap === "number" && Number.isFinite(vwap) ? (
                        <>
                          {" "}
                          | VWAP:{" "}
                          <span style={{ fontFamily: MONO, color: colors.text }}>${vwap.toFixed(2)}</span>
                        </>
                      ) : null}
                    </p>
                    {zone ? (
                      <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs, fontFamily: MONO }}>
                        Historical entry zone: ${zone.lo.toFixed(2)}–${zone.hi.toFixed(2)}
                      </p>
                    ) : null}
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>{expiryNote}</p>
                    <div style={{ height: 10, background: colors.surfaceMuted, borderRadius: borderRadius.full, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${fillPct}%`,
                          borderRadius: borderRadius.full,
                          background: up ? colors.bullish : colors.bearish,
                          opacity: 0.92
                        }}
                      />
                    </div>
                    <div style={{ display: "inline-flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
                      {(() => {
                        // Build the Scenario Builder input from this
                        // setup row. We forward whatever structural
                        // data we have; eligibility decides enabled vs
                        // disabled.
                        const sym = setup.symbol.trim().toUpperCase();
                        const setupDirection: ScenarioInput["direction"] =
                          isLongDirection(setup.direction)
                            ? "bullish"
                            : /short|bear/i.test(setup.direction)
                              ? "bearish"
                              : "neutral";
                        const setupMode: ScenarioInput["mode"] =
                          setup.scanner_mode === "swing_daily" ? "swing" : "day";
                        const scenarioInput: ScenarioInput = {
                          symbol: sym,
                          direction: setupDirection,
                          mode: setupMode,
                          generated_at: setup.timestamp_iso,
                          reference: {
                            current_price: setup.last_price ?? null
                          },
                          volatility_regime: overviewRegimeToVolatilityRegime(overview.regimeLabel),
                          tags: setup.triggers && setup.triggers.length > 0 ? setup.triggers.slice(0, 3) : undefined
                        };
                        return (
                          <ScenarioBuilderInline
                            input={scenarioInput}
                            readiness={{
                              symbol: sym,
                              mode: setupMode,
                              setupBias:
                                setupDirection === "bullish"
                                  ? "Bullish"
                                  : setupDirection === "bearish"
                                    ? "Bearish"
                                    : "Neutral",
                              hasReferenceLevels: setup.last_price != null
                            }}
                            drillDown={{ surface: "scanner" }}
                            testId={`build-scenario-setup-${sym}`}
                          />
                        );
                      })()}
                      {brokersEnabled() ? (
                        <span
                          title={orbExpired ? "ORB window has closed for today" : undefined}
                          style={{ display: "inline-flex", cursor: orbExpired ? "not-allowed" : undefined }}
                        >
                          <button
                            type="button"
                            disabled={orbExpired}
                            onClick={() => {
                              if (orbExpired) return;
                              const sym = setup.symbol.trim().toUpperCase();
                              goToPortfolioOrder({
                                symbol: sym,
                                side: isLongDirection(setup.direction) ? "buy" : "sell",
                                pattern: setup.triggers[0] || "intraday_setup",
                                signal_strength: String(topSignalStrengthPercent(setup)),
                                signal_direction: setup.direction,
                                ...(setup.confluence_score != null
                                  ? { confluence_score: String(Math.round(setup.confluence_score)) }
                                  : {})
                              });
                            }}
                            style={{
                              border: `1px solid ${orbExpired ? "var(--color-border)" : colors.accent}`,
                              borderRadius: borderRadius.md,
                              background: orbExpired ? "var(--color-background-secondary)" : "rgba(59,130,246,0.22)",
                              color: orbExpired ? "var(--color-text-tertiary)" : colors.accent,
                              padding: `${spacing[2]} ${spacing[3]}`,
                              cursor: orbExpired ? "not-allowed" : "pointer",
                              fontSize: typography.scale.sm,
                              fontWeight: orbExpired ? 500 : 700,
                              letterSpacing: orbExpired ? undefined : "0.02em",
                              boxShadow: orbExpired ? undefined : "0 0 14px rgba(59,130,246,0.18)",
                              opacity: orbExpired ? 0.4 : 1
                            }}
                          >
                            Open order entry
                          </button>
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={async () => {
                          const sym = setup.symbol.trim().toUpperCase();
                          setEvidenceLoading(true);
                          setEvidenceLoadingSymbol(sym);
                          setEvidence(null);
                          setEvidenceOpen(true);
                          try {
                            let symbolNewsArticles: Awaited<ReturnType<typeof fetchSymbolNews>> = [];
                            try {
                              symbolNewsArticles = await fetchSymbolNews(setup.symbol, 10, {
                                newsTradingMode: groupTradingMode
                              });
                            } catch {
                              symbolNewsArticles = [];
                            }
                            const risk = earningsRiskFor(setup.symbol);
                            const s = (await fetchSymbolSnapshot(sym)) ?? undefined;
                            const base = buildEvidenceFromSetup(setup, s, {
                              symbolNewsArticles,
                              earningsRiskDays: risk?.daysUntil,
                              earningsReportTime: risk?.reportTime
                            });
                            setEvidence(await enrichEvidenceWithComposite(base, groupTradingMode));
                          } finally {
                            setEvidenceLoading(false);
                            setEvidenceLoadingSymbol(null);
                          }
                        }}
                        disabled={evidenceLoading}
                        style={{
                          border: `1px solid ${colors.border}`,
                          borderRadius: borderRadius.md,
                          background: colors.surfaceMuted,
                          color: colors.text,
                          padding: `${spacing[1]} ${spacing[2]}`,
                          cursor: evidenceLoading ? "wait" : "pointer",
                          opacity: evidenceLoading ? 0.72 : 1,
                          fontSize: typography.scale.xs,
                          fontWeight: 500
                        }}
                      >
                        {evidenceLoading ? "Preparing signal..." : "View Evidence"}
                      </button>
                      {/*
                       Mode Separation: each setup carries its own engine
                       (swing_daily → swing engine; everything else → day
                       engine). Propagating trading_mode in the deep link
                       ensures the user lands in the same engine they
                       clicked on, never the other one's localStorage
                       default.
                      */}
                      <ScannerOpenSignalsLink
                        href={scannerToSignalsHref(
                          setup.symbol.trim().toUpperCase(),
                          setup.scanner_mode === "swing_daily" ? "swing" : "day"
                        )}
                        borderColor={colors.border}
                        accentColor={colors.accent}
                      />
                      <InfoTip text={SETUP_RELATIVE_VOLUME_TIP} label="Relative volume" />
                    </div>
                    <div style={{ position: "absolute", right: spacing[3], bottom: spacing[3] }}>
                      <SignalDisclaimerChip />
                    </div>
                  </motion.article>
                );
              })
                )}
              </Fragment>
            ))}
          </div>
        </section>
      </div>

      <LaggardScanner visible={scannerSetupMode === "swing" || scannerSetupMode === "both"} />

      <GapCatalystNewsDrawer
        open={gapNewsDrawerItem != null && !!gapNewsDrawerItem.catalyst}
        payload={
          gapNewsDrawerItem?.catalyst
            ? { symbol: gapNewsDrawerItem.symbol, catalyst: gapNewsDrawerItem.catalyst }
            : null
        }
        onClose={() => setGapNewsDrawerItem(null)}
        onViewSignal={() => {
          const it = gapNewsDrawerItem;
          setGapNewsDrawerItem(null);
          if (it) void openGapEvidence(it);
        }}
      />
      <SignalEvidenceModal
        open={evidenceOpen}
        evidence={evidence}
        loading={evidenceLoading}
        loadingSymbol={evidenceLoadingSymbol}
        onClose={() => {
          setEvidenceOpen(false);
          setEvidenceLoading(false);
          setEvidenceLoadingSymbol(null);
        }}
        gapIntelSnapshot={(() => {
          const sym = (evidence?.symbol ?? evidenceLoadingSymbol ?? "").trim().toUpperCase();
          return sym ? scannerGapIntelBySymbol[sym] ?? null : null;
        })()}
        onOpenNewsPanel={(sym) => {
          setNewsPanelSymbol(sym.trim().toUpperCase());
          setNewsPanelOpen(true);
        }}
      />
      <NewsPanel
        symbol={newsPanelSymbol}
        isOpen={newsPanelOpen}
        onClose={() => setNewsPanelOpen(false)}
        newsTradingMode={panelNewsTradingMode}
      />
    </section>
  );
}
