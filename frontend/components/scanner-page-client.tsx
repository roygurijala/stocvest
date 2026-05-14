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
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { GapCatalystNewsDrawer } from "@/components/gap-catalyst-news-drawer";
import { NewsPanel } from "@/components/news-panel";
import { BuildScenarioButton } from "@/components/scenario-builder/build-scenario-button";
import { ScannerEmptyStateCard } from "@/components/scanner-empty-state-card";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import { loadScannerDataWithoutBrief } from "@/lib/api/scanner-client-load";
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
import type { EarningsEvent } from "@/lib/api/earnings";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { brokersEnabled } from "@/lib/nav-features";
import {
  TAB_LABEL_BOTH,
  TAB_LABEL_DAY,
  TAB_LABEL_SWING
} from "@/lib/mode-terminology";
import {
  buildDayEmptyStateContext,
  buildGapIntelEmptyStateContext,
  buildSwingEmptyStateContext
} from "@/lib/scanner-empty-state";
import type { ScenarioInput, VolatilityRegime } from "@/lib/scenario/types";
import { roleAccents } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

/**
 * Map the macro regime label the scanner overview carries (engine form
 * — `"risk_on"` / `"neutral"` / `"risk_off"` / `"avoid"` / `"unknown"`,
 * or arbitrary free text from cached responses) onto the closed-set
 * volatility regime the Scenario Builder consumes. The mapping is
 * conservative: anything we don't recognize falls through to
 * `"unknown"`, which the eligibility gate treats as "not enough
 * volatility context to scaffold a stop."
 */
function regimeLabelToVolatilityRegime(label: string | null | undefined): VolatilityRegime {
  const norm = (label ?? "").trim().toLowerCase();
  if (!norm) return "unknown";
  if (norm.includes("risk_on") || norm === "risk-on" || norm.includes("low")) return "low";
  if (norm.includes("neutral") || norm.includes("normal")) return "normal";
  if (norm.includes("risk_off") || norm === "risk-off" || norm.includes("elevated")) return "elevated";
  if (norm.includes("avoid") || norm.includes("extreme")) return "extreme";
  return "unknown";
}
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { fetchSymbolMinuteBars } from "@/lib/fetch-symbol-bars";
import { buildEvidenceFromSetup, enrichEvidenceWithComposite, type SignalEvidenceData } from "@/lib/signal-evidence";
import {
  gapIntelligenceHiddenCountForModeDefault,
  gapIntelligenceRowMatchesScannerModeDefault,
  resolveEvidenceTradingMode,
  resolveGapCardTradingMode,
  resolveSetupRowTradingMode
} from "@/lib/scanner-mode-resolution";
import { topSignalStrengthPercent } from "@/lib/top-signal-strength";
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

interface ScannerPageClientProps {
  initialOverview: ScannerOverview;
  initialTimestampIso: string;
  earningsBySymbol: Record<string, EarningsEvent>;
}

const SCANNER_MODE_STORAGE_KEY = "stocvest_scanner_mode";
const SECONDARY_SHARED_CATALYST_HEADLINE = "Referenced in related news — see primary ticker";

const MONO = typography.fontFamilyMono;

function gapItemDisplayCompany(item: GapIntelligenceItem): string {
  const a = item.company_name;
  const b = (item as { companyName?: string }).companyName;
  return (typeof a === "string" && a.trim() ? a : typeof b === "string" ? b : "").trim();
}

const CONFLUENCE_BADGE_STYLE: CSSProperties = {
  background: "linear-gradient(135deg, #b8860b, #f5c542)",
  color: "#1a1200",
  fontSize: "10px",
  fontWeight: 700,
  letterSpacing: "2px",
  padding: "3px 10px",
  borderRadius: "4px",
  textTransform: "uppercase"
};

function isLongDirection(direction: string): boolean {
  return ["bullish", "long"].includes(direction.toLowerCase());
}

function formatSignalFiredTimeEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function isSecondarySharedCatalyst(item: GapIntelligenceItem): boolean {
  const h = item.catalyst?.headline;
  return typeof h === "string" && h.trim() === SECONDARY_SHARED_CATALYST_HEADLINE;
}

export function ScannerPageClient({ initialOverview, initialTimestampIso, earningsBySymbol }: ScannerPageClientProps) {
  const { colors, theme } = useTheme();
  const [overview, setOverview] = useState<ScannerOverview>(initialOverview);
  const [scannerSetupMode, setScannerSetupMode] = useState<ScannerSetupLoadMode>("swing");
  const [showAllGaps, setShowAllGaps] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceLoadingSymbol, setEvidenceLoadingSymbol] = useState<string | null>(null);
  const [newsPanelSymbol, setNewsPanelSymbol] = useState("");
  const [newsPanelOpen, setNewsPanelOpen] = useState(false);
  const [gapNewsDrawerItem, setGapNewsDrawerItem] = useState<GapIntelligenceItem | null>(null);
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
    // Resolve initial scanner mode with URL > localStorage > default.
    //
    // Priority order matters here:
    //   1. `?mode=day|swing|both` query param — explicit deep-link from
    //      the Day Desk / Swing Desk "View scanner →" footer links, the
    //      sidebar, or any external bookmark. Honoring URL first is the
    //      reason the user reported "View day scanner takes me to swing
    //      scanner": before this fix, only localStorage was read, so
    //      whatever mode the user last visited won regardless of the
    //      URL. URL-priority makes deep-links authoritative.
    //   2. `localStorage` (`stocvest_scanner_mode`) — the user's last
    //      sticky preference. Used when the URL has no `mode`.
    //   3. Component default ("swing") — first-time visit, no URL hint,
    //      no localStorage entry.
    //
    // Wrapped in try/catch because both `window.location` and
    // `localStorage` can throw in SSR-style edge cases (jest/jsdom
    // without origin, Safari private mode for storage, etc.).
    try {
      const url = new URL(window.location.href);
      const urlMode = url.searchParams.get("mode");
      if (urlMode === "day" || urlMode === "swing" || urlMode === "both") {
        setScannerSetupMode(urlMode);
        try {
          localStorage.setItem(SCANNER_MODE_STORAGE_KEY, urlMode);
        } catch {
          /* ignore */
        }
        return;
      }
    } catch {
      /* ignore — fall through to localStorage */
    }
    try {
      const raw = localStorage.getItem(SCANNER_MODE_STORAGE_KEY);
      if (raw === "day" || raw === "swing" || raw === "both") {
        setScannerSetupMode(raw);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const core = await loadScannerDataWithoutBrief(null, [], {
        parallelDefaultWatchlist: true,
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
      setOverview((prev) => ({
        gapIntelligence: core.gapIntelligence,
        setups: core.setups,
        morningBrief: prev.morningBrief,
        error: undefined,
        spyPct: core.spyPct,
        qqqPct: core.qqqPct,
        regimeLabel: core.regimeLabel
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [scannerSetupMode]);

  useEffect(() => {
    setShowAllGaps(false);
  }, [scannerSetupMode]);

  const persistScannerMode = useCallback((m: ScannerSetupLoadMode) => {
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
  }, []);

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

  const gapIntelHiddenCount = useMemo(
    () => gapIntelligenceHiddenCountForModeDefault(scannerSetupMode, overview.gapIntelligence),
    [scannerSetupMode, overview.gapIntelligence]
  );

  const gapIntelForDisplay = useMemo(() => {
    const raw = overview.gapIntelligence;
    if (scannerSetupMode === "both" || showAllGaps) return raw;
    return raw.filter((g) => gapIntelligenceRowMatchesScannerModeDefault(scannerSetupMode, g.mode_best_fit));
  }, [overview.gapIntelligence, scannerSetupMode, showAllGaps]);

  const gapIntelGrouped = useMemo(() => {
    const items = [...gapIntelForDisplay].sort(
      (a, b) => b.gap_quality_score - a.gap_quality_score
    );
    const withCat = items.filter((x) => x.has_catalyst);
    const without = items.filter((x) => !x.has_catalyst);
    return { withCat, without };
  }, [gapIntelForDisplay]);

  function qualityBarStyle(score: number, colors: ThemeColors): { fill: string; glow?: string } {
    if (score >= 80) return { fill: "#4ade80", glow: "0 0 12px rgba(74,222,128,0.45)" };
    if (score >= 60) return { fill: colors.bullish };
    if (score >= 40) return { fill: colors.caution };
    return { fill: colors.bearish };
  }

  function gapSyntheticSetup(item: GapIntelligenceItem): IntradaySetupPayload {
    return {
      symbol: item.symbol,
      direction: item.gap_pct >= 0 ? "long" : "short",
      score: Math.min(0.99, item.gap_quality_score / 100),
      triggers: ["gap_intelligence"],
      timestamp_iso: new Date().toISOString()
    };
  }

  function renderGapIntelCard(item: GapIntelligenceItem, idx: number, noCatSection: boolean) {
    const snap = snapBySymbol[item.symbol] ?? null;
    const pmh = pmhBySymbol[item.symbol];
    const ctx = gapDirectionContext({ gap_percent: item.gap_pct }, snap);
    const vol = item.volume || 0;
    const qStyle = qualityBarStyle(item.gap_quality_score, colors);
    const sent = (item.catalyst?.sentiment || "").toLowerCase();
    const sentBg =
      sent === "bullish"
        ? "rgba(34,197,94,.15)"
        : sent === "bearish"
          ? "rgba(239,68,68,.15)"
          : "rgba(245,158,11,.18)";
    const sentFg = sent === "bullish" ? colors.bullish : sent === "bearish" ? colors.bearish : colors.caution;
    return (
      <motion.article
        key={`${item.symbol}-${noCatSection ? "nc" : "c"}-${idx}`}
        className={surfaceGlowClassName}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.05 }}
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.lg,
          padding: spacing[3],
          borderLeft: noCatSection ? `4px solid ${colors.caution}` : undefined
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, width: "100%" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: spacing[2],
              flexWrap: "wrap",
              width: "100%",
              minWidth: 0
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "15px", color: colors.text }}>{item.symbol}</span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: spacing[1], flexShrink: 0, marginLeft: "auto" }}>
              {(() => {
                const b = earningsBadgeFor(item.symbol);
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
                  fontSize: typography.scale.xs,
                  fontFamily: MONO,
                  fontWeight: 700,
                  ...(item.gap_pct > 0
                    ? { background: "rgba(34,197,94,0.18)", color: colors.bullish }
                    : item.gap_pct < 0
                      ? { background: "rgba(239,68,68,0.18)", color: colors.bearish }
                      : { background: colors.surfaceMuted, color: colors.textMuted })
                }}
              >
                {item.gap_pct > 0 ? "+" : ""}
                {item.gap_pct.toFixed(2)}%
              </span>
              {confluenceAlertSymbols.has(item.symbol.trim().toUpperCase()) ? (
                <span style={CONFLUENCE_BADGE_STYLE}>CONFLUENCE</span>
              ) : null}
            </div>
          </div>
          {gapItemDisplayCompany(item) ? (
            <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{gapItemDisplayCompany(item)}</span>
          ) : null}
          <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>Pre-market gap</span>
        </div>
          <div style={{ marginTop: spacing[2] }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2] }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Event significance</span>
              <InfoTip text={EVENT_SIGNIFICANCE_SCORE_TIP} label="What event significance measures" maxWidth={280} />
            </div>
            <span style={{ fontSize: typography.scale.xs, fontFamily: MONO }}>
              {item.gap_quality_score}/100
            </span>
          </div>
          <div
            style={{
              marginTop: 4,
              height: 8,
              background: colors.surfaceMuted,
              borderRadius: borderRadius.full,
              overflow: "hidden"
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, item.gap_quality_score)}%`,
                borderRadius: borderRadius.full,
                background: qStyle.fill,
                boxShadow: qStyle.glow,
                minWidth: "8%"
              }}
            />
          </div>
          <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.xs, fontFamily: MONO }}>
            Vol: {formatVolumeShort(vol)} ({item.volume_vs_avg.toFixed(1)}x avg) · Price: ${item.current_price.toFixed(2)}
          </p>
        </div>
        {typeof pmh === "number" && Number.isFinite(pmh) ? (
          <p style={{ margin: `${spacing[1]} 0 0`, color: colors.textMuted, fontSize: typography.scale.xs, fontFamily: MONO }}>
            PMH: ${pmh.toFixed(2)}
          </p>
        ) : null}
        {ctx ? (
          <p style={{ margin: `${spacing[1]} 0 0`, color: colors.text, fontSize: typography.scale.xs }}>{ctx}</p>
        ) : null}
        {item.has_catalyst && item.catalyst ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="Open news article"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openGapNews(item);
              }
            }}
            onClick={() => openGapNews(item)}
            style={{
              marginTop: spacing[2],
              cursor: "pointer",
              borderRadius: borderRadius.md,
              padding: spacing[1],
              marginLeft: `-${spacing[1]}`,
              marginRight: `-${spacing[1]}`,
              outline: "none",
              border: `1px solid transparent`
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = colors.border;
              e.currentTarget.style.background = colors.surfaceMuted;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "transparent";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <p style={{ margin: 0, fontSize: typography.scale.xs, fontWeight: 700, color: colors.textMuted }}>WITH CATALYST</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], marginTop: spacing[1] }}>
              <span
                style={{
                  background: "rgba(59,130,246,0.12)",
                  color: colors.accent,
                  borderRadius: borderRadius.full,
                  padding: "2px 8px",
                  fontSize: typography.scale.xs
                }}
              >
                {item.catalyst.category}
              </span>
              <span
                style={{
                  borderRadius: borderRadius.full,
                  padding: "2px 8px",
                  fontSize: typography.scale.xs,
                  fontWeight: 600,
                  background: sentBg,
                  color: sentFg
                }}
              >
                {item.catalyst.sentiment}
              </span>
            </div>
            <p
              style={{
                margin: `${spacing[2]} 0 0`,
                fontSize: typography.scale.sm,
                color: colors.text,
                lineHeight: 1.35,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden"
              }}
            >
              {item.catalyst.headline}
            </p>
            <p style={{ margin: `${spacing[1]} 0 0`, fontSize: 10, color: colors.textMuted }}>Tap to read full article</p>
          </div>
        ) : (
          <div style={{ marginTop: spacing[2] }}>
            <div style={{ display: "flex", gap: spacing[2], alignItems: "flex-start" }}>
              <span
                aria-hidden
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: "6px solid transparent",
                  borderRight: "6px solid transparent",
                  borderBottom: `10px solid ${colors.caution}`,
                  marginTop: 3,
                  flexShrink: 0
                }}
              />
              <div>
                <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.caution, fontWeight: 600 }}>
                  No catalyst found — momentum gap only
                </p>
                <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted }}>
                  Price-only gaps carry higher reversal risk
                </p>
              </div>
            </div>
          </div>
        )}
        {/* B30 Phase 4: "Best evaluated as" classifier tag. Advisory — shows
            which engine the View Signal click will route to in the 'both'
            scanner view, and which engine is best-fit for swing/day views.
            Hidden when the verdict is unavailable (e.g. cached pre-Phase-4
            response) since we can't justify a guess. */}
        {item.mode_best_fit ? (() => {
          const verdictMode = resolveGapCardTradingMode(scannerSetupMode, item.mode_best_fit);
          const isExplicitContext = scannerSetupMode === "swing" || scannerSetupMode === "day";
          const verdict = item.mode_best_fit;
          // Pill copy: short and unambiguous.
          const label =
            verdict === "swing"
              ? "Best evaluated as: Swing (multi-day)"
              : verdict === "day"
                ? "Best evaluated as: Day (intraday)"
                : "Best evaluated as: Either desk";
          // Color tokens follow the design system role contract:
          //   swing → accent (cool/structural), day → caution (warm/active),
          //   either → textMuted (neutral). Background is a subtle tint of
          //   the role color so the pill reads as an annotation, not a CTA.
          const pillFg =
            verdict === "swing" ? colors.accent : verdict === "day" ? colors.caution : colors.textMuted;
          const pillBg =
            verdict === "swing"
              ? "rgba(59,130,246,0.10)"
              : verdict === "day"
                ? "rgba(245,158,11,0.12)"
                : "rgba(148,163,184,0.10)";
          const tipText = isExplicitContext
            ? `You're in ${scannerSetupMode === "swing" ? "Swing" : "Day"} scanner mode, so the View Signal click opens the ${scannerSetupMode === "swing" ? "Swing" : "Day"} engine regardless of this verdict. The tag indicates the classifier's best-fit assessment for this gap.`
            : verdictMode === verdict
              ? "View Signal opens this engine."
              : "View Signal opens the Swing engine by default. Switch the scanner to Day mode to open the Day engine on this gap.";
          return (
            <div style={{ marginTop: spacing[2], display: "flex", flexDirection: "column", gap: spacing[1] }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: spacing[1], flexWrap: "wrap" }}>
                <span
                  data-testid="gap-mode-best-fit"
                  data-mode-best-fit={verdict}
                  style={{
                    borderRadius: borderRadius.full,
                    padding: "2px 10px",
                    fontSize: typography.scale.xs,
                    fontWeight: 600,
                    background: pillBg,
                    color: pillFg,
                    border: `1px solid ${pillFg}`,
                    letterSpacing: "0.02em"
                  }}
                >
                  {label}
                </span>
                <InfoTip text={tipText} label="Best evaluated as — why this verdict" maxWidth={320} />
              </div>
              {item.mode_best_fit_reasons && item.mode_best_fit_reasons.length > 0 ? (
                <p
                  style={{
                    margin: 0,
                    fontSize: typography.scale.xs,
                    color: colors.textMuted,
                    lineHeight: 1.35
                  }}
                >
                  {item.mode_best_fit_reasons.join(" \u00b7 ")}
                </p>
              ) : null}
            </div>
          );
        })() : null}
        <div style={{ marginTop: spacing[2], display: "inline-flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
          <button
            type="button"
            onClick={() => void openGapEvidence(item)}
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
            {evidenceLoading ? "Preparing signal..." : "View Signal"}
          </button>
          <AddToWatchlistButton symbol={item.symbol} />
          {(() => {
            // Build the Scenario Builder input from the gap card's
            // structural fields. The eligibility helper decides whether
            // the button renders enabled or disabled-with-tooltip; we
            // don't pre-judge here.
            const sym = item.symbol.trim().toUpperCase();
            const gapDirection: ScenarioInput["direction"] =
              item.gap_pct > 0 ? "bullish" : item.gap_pct < 0 ? "bearish" : "neutral";
            const scenarioInput: ScenarioInput = {
              symbol: sym,
              direction: gapDirection,
              mode: "day",
              generated_at: new Date().toISOString(),
              reference: {
                current_price: item.current_price,
                prev_close: item.prev_close
              },
              volatility_regime: regimeLabelToVolatilityRegime(overview.regimeLabel),
              tags: [
                `Gap ${item.gap_pct >= 0 ? "+" : ""}${item.gap_pct.toFixed(2)}%`,
                item.has_catalyst ? "With catalyst" : "Momentum-only"
              ]
            };
            return <BuildScenarioButton input={scenarioInput} testId={`build-scenario-gap-${sym}`} />;
          })()}
          {brokersEnabled() ? (
            <span title="ORB window has closed for today" style={{ display: "inline-flex" }}>
              <button
                type="button"
                onClick={() => {
                  const sym = item.symbol.trim().toUpperCase();
                  const setupFor = overview.setups.find((s) => s.symbol.trim().toUpperCase() === sym);
                  goToPortfolioOrder({
                    symbol: sym,
                    side: item.gap_pct >= 0 ? "buy" : "sell",
                    pattern: "pre_market_gap",
                    signal_strength: String(Math.min(100, Math.max(0, Math.round(item.gap_quality_score)))),
                    signal_direction: item.gap_pct >= 0 ? "bullish" : "bearish",
                    ...(setupFor?.confluence_score != null
                      ? { confluence_score: String(Math.round(setupFor.confluence_score)) }
                      : {})
                  });
                }}
                style={{
                  border: `1px solid ${colors.accent}`,
                  borderRadius: borderRadius.md,
                  background: "rgba(59,130,246,0.22)",
                  color: colors.accent,
                  padding: `${spacing[2]} ${spacing[3]}`,
                  cursor: "pointer",
                  fontSize: typography.scale.sm,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                  boxShadow: "0 0 14px rgba(59,130,246,0.18)"
                }}
              >
                Open order entry
              </button>
            </span>
          ) : null}
        </div>
        <p
          style={{
            margin: `${spacing[2]} 0 0`,
            fontSize: typography.scale.xs,
            color: colors.textMuted,
            lineHeight: 1.45,
            maxWidth: "100%"
          }}
        >
          Use Watchlist to track for post-gap base or mean-reversion.
        </p>
        <p
          style={{
            margin: `${spacing[2]} 0 0`,
            fontSize: 10,
            color: colors.textMuted,
            letterSpacing: 0.02,
            textTransform: "uppercase"
          }}
        >
          Not investment advice
        </p>
      </motion.article>
    );
  }

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
        scannerSetupLoadMode: scannerSetupMode,
        intradayBarLimit: 120,
        daySetupsLimit: 10,
        swingSetupsLimit: 6
      });
      if (core.error) {
        setOverview((prev) => ({ ...prev, error: core.error }));
      } else {
        setOverview((prev) => ({
          gapIntelligence: core.gapIntelligence,
          setups: core.setups,
          morningBrief: prev.morningBrief,
          error: undefined,
          spyPct: core.spyPct,
          qqqPct: core.qqqPct,
          regimeLabel: core.regimeLabel
        }));
      }
      router.refresh();
    });
  }, [router, startTransition, scannerSetupMode]);

  const marketOpen = isUsRegularSessionOpenEt();
  const secondsToScan = Math.max(0, Math.ceil((nextScanRef.current - Date.now()) / 1000));
  const scanCountdownLabel = `${Math.floor(secondsToScan / 60)}:${String(secondsToScan % 60).padStart(2, "0")}`;

  const setupsPanelTitle =
    scannerSetupMode === "swing"
      ? "Swing setups (daily)"
      : scannerSetupMode === "both"
        ? "Setups · swing + day (two separate desks)"
        : "Day setups (intraday)";

  const panelNewsTradingMode = scannerSetupMode === "day" ? "day" : "swing";
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
  usePublishAssistantContext(assistantContext);

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

      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0" style={{ display: "grid", gap: spacing[1] }}>
          <p className="text-sm sm:text-base" style={{ margin: 0, color: colors.textMuted }}>
            Last scan: {new Date(initialTimestampIso).toLocaleString()}
          </p>
          <p className="text-xs sm:text-sm" style={{ margin: 0, color: colors.textMuted }}>
            {marketOpen ? (
              <>
                Next scan in <strong style={{ color: colors.text }}>{scanCountdownLabel}</strong>
              </>
            ) : (
              <>Market closed — showing last scan</>
            )}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 sm:w-auto"
          onClick={onManualRefresh}
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.md,
            background: colors.surface,
            color: colors.text,
            padding: `${spacing[2]} ${spacing[3]}`,
            cursor: "pointer"
          }}
        >
          <RefreshCw size={14} style={{ animation: isPending ? "spin 1s linear infinite" : undefined }} />
          {isPending ? "Refreshing..." : "Refresh"}
        </button>
      </header>

      <div
        role="tablist"
        aria-label="Scanner setup source"
        className="flex flex-wrap gap-2"
        style={{ marginTop: 0 }}
        data-testid="scanner-mode-tablist"
      >
        {(["swing", "day", "both"] as const).map((m) => {
          const active = scannerSetupMode === m;
          // Tab labels and role accents live in `lib/mode-terminology` +
          // `lib/design-system.roleAccents`. The role accent is the SAME
          // hue family used on the dashboard's Swing Desk / Day Desk /
          // Shared Context master cards — so the user reading a Swing
          // pill anywhere in the app gets the same indigo-violet at a
          // glance. Active-state tab gets the role's `borderAccent` (the
          // "rail line" hue) and a tinted background mixed from that
          // same accent, so peripheral vision can resolve mode without
          // reading copy.
          const role = m === "swing" ? "swing" : m === "day" ? "day" : "shared";
          const accent = roleAccents[theme][role];
          const railHue = accent.borderAccent;
          const label = m === "swing" ? TAB_LABEL_SWING : m === "day" ? TAB_LABEL_DAY : TAB_LABEL_BOTH;
          const cadence = m === "swing" ? "Multi-day" : m === "day" ? "Intraday" : "Two desks";
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              // Pin the accessible name to the short tab label so
              // screen-readers and `getByRole("tab", { name: "Swing" })`
              // assertions don't catch the secondary cadence sub-line
              // ("Multi-day" / "Intraday" / "Two desks"). The cadence
              // word is decorative — it reinforces what the tab means
              // for sighted users but should not bloat the accessible
              // name.
              aria-label={label}
              data-testid={`scanner-mode-tab-${m}`}
              data-active={active ? "true" : "false"}
              data-role={role}
              onClick={() => persistScannerMode(m)}
              style={{
                position: "relative",
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 2,
                borderRadius: borderRadius.md,
                border: `${active ? 2 : 1}px solid ${active ? railHue : colors.border}`,
                padding: `${spacing[2]} ${spacing[4]}`,
                fontSize: typography.scale.sm,
                fontWeight: active ? 700 : 500,
                background: active
                  ? `color-mix(in srgb, ${railHue} 14%, ${colors.surface})`
                  : colors.surface,
                color: active ? accent.accentStrong : colors.text,
                cursor: "pointer",
                minWidth: 84,
                transition: "background 120ms ease, border-color 120ms ease"
              }}
            >
              <span style={{ fontSize: typography.scale.sm, lineHeight: 1.1 }}>{label}</span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: active ? railHue : colors.textMuted,
                  lineHeight: 1.1
                }}
              >
                {cadence}
              </span>
            </button>
          );
        })}
      </div>

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

      <div className="scanner-grid grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section
          className={`min-w-0 ${surfaceGlowClassName}`}
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
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
              <h3 style={{ margin: 0 }}>Gap Intelligence</h3>
              <p
                style={{
                  margin: `${spacing[1]} 0 0`,
                  fontSize: typography.scale.xs,
                  color: colors.textMuted,
                  lineHeight: 1.45,
                  maxWidth: "42rem"
                }}
              >
                Extreme moves to monitor — not swing entries on the gap.
              </p>
            </div>
            <InfoTip text={GAP_INTELLIGENCE_TIP} label="About gap intelligence" />
          </div>
          {(scannerSetupMode === "swing" || scannerSetupMode === "day") && overview.gapIntelligence.length > 0 ? (
            <div
              style={{
                marginBottom: spacing[2],
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: spacing[2]
              }}
            >
              {!showAllGaps && gapIntelHiddenCount > 0 ? (
                <span
                  data-testid="scanner-gap-hidden-count"
                  style={{ fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}
                >
                  + {gapIntelHiddenCount}{" "}
                  {scannerSetupMode === "swing" ? "day-fit" : "swing-fit"} gaps hidden
                </span>
              ) : null}
              <button
                type="button"
                data-testid={showAllGaps ? "scanner-gap-filter-show-matched-only" : "scanner-gap-filter-show-all"}
                onClick={() => setShowAllGaps((v) => !v)}
                style={{
                  border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.md,
                  background: colors.surfaceMuted,
                  color: colors.text,
                  padding: `${spacing[1]} ${spacing[3]}`,
                  fontSize: typography.scale.xs,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                {showAllGaps ? "Show mode-matched gaps only" : "Show all gaps"}
              </button>
            </div>
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
                    swingUniverseSymbolCount: overview.swingUniverseSymbolCount
                  },
                  scannerSetupMode === "day" ? "day" : "swing"
                )}
                compact
                testId="scanner-gap-empty-state"
              />
            ) : gapIntelForDisplay.length === 0 ? (
              <div
                data-testid="scanner-gap-filter-empty"
                style={{
                  borderRadius: borderRadius.md,
                  border: `1px dashed ${colors.border}`,
                  background: "rgba(148,163,184,0.06)",
                  padding: spacing[3]
                }}
              >
                <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, fontWeight: 600 }}>
                  No gaps match this tab&apos;s default filter
                </p>
                <p
                  style={{
                    margin: `${spacing[2]} 0 0`,
                    fontSize: typography.scale.xs,
                    color: colors.textMuted,
                    lineHeight: 1.5
                  }}
                >
                  Loaded gaps are classified as a better fit for the other desk. Open the full list to see them.
                </p>
                <button
                  type="button"
                  data-testid="scanner-gap-filter-show-all-from-empty"
                  onClick={() => setShowAllGaps(true)}
                  style={{
                    marginTop: spacing[2],
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    background: colors.surfaceMuted,
                    color: colors.text,
                    padding: `${spacing[1]} ${spacing[3]}`,
                    fontSize: typography.scale.xs,
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  Show all gaps
                </button>
              </div>
            ) : (
              <>
                {gapIntelGrouped.withCat.map((item, idx) => renderGapIntelCard(item, idx, false))}
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
                {gapIntelGrouped.without.map((item, idx) => renderGapIntelCard(item, idx + gapIntelGrouped.withCat.length, true))}
              </>
            )}
          </div>
        </section>

        <section
          className={`min-w-0 ${surfaceGlowClassName}`}
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
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
                      ? buildDayEmptyStateContext({
                          regimeLabel: overview.regimeLabel,
                          spyPct: overview.spyPct,
                          qqqPct: overview.qqqPct,
                          swingUniverseSymbolCount: overview.swingUniverseSymbolCount
                        })
                      : buildSwingEmptyStateContext({
                          regimeLabel: overview.regimeLabel,
                          spyPct: overview.spyPct,
                          qqqPct: overview.qqqPct,
                          swingUniverseSymbolCount: overview.swingUniverseSymbolCount
                        });
                    return (
                      <ScannerEmptyStateCard
                        context={context}
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
                          volatility_regime: regimeLabelToVolatilityRegime(overview.regimeLabel),
                          tags: setup.triggers && setup.triggers.length > 0 ? setup.triggers.slice(0, 3) : undefined
                        };
                        return (
                          <BuildScenarioButton
                            input={scenarioInput}
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
                      <Link
                        // Mode Separation: each setup carries its own engine
                        // (swing_daily → swing engine; everything else → day
                        // engine). Propagating trading_mode in the deep link
                        // ensures the user lands in the same engine they
                        // clicked on, never the other one's localStorage
                        // default.
                        href={`/dashboard/signals?symbol=${encodeURIComponent(setup.symbol.trim().toUpperCase())}&ref=scanner&trading_mode=${setup.scanner_mode === "swing_daily" ? "swing" : "day"}`}
                        className="inline-flex min-h-8 items-center rounded-md px-2 text-xs font-medium no-underline"
                        style={{ border: `1px solid ${colors.border}`, color: colors.accent, alignSelf: "center" }}
                      >
                        Open Signals
                      </Link>
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
