"use client";

import {
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
import { useRouter } from "next/navigation";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { GapCatalystNewsDrawer } from "@/components/gap-catalyst-news-drawer";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import type { GapIntelligenceItem, IntradaySetupPayload, ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { fetchSymbolMinuteBars } from "@/lib/fetch-symbol-bars";
import { buildEvidenceFromSetup, type SignalEvidenceData } from "@/lib/signal-evidence";
import {
  CONFIDENCE_PERCENT_TIP,
  GAP_INTELLIGENCE_TIP,
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

export function ScannerPageClient({ initialOverview, initialTimestampIso, earningsBySymbol }: ScannerPageClientProps) {
  const { colors } = useTheme();
  const [isPending, startTransition] = useTransition();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
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

  const symbolsKey = useMemo(
    () =>
      [
        ...new Set([
          ...initialOverview.gapIntelligence.map((g) => g.symbol),
          ...initialOverview.setups.map((s) => s.symbol)
        ])
      ]
        .sort()
        .join(","),
    [initialOverview.gapIntelligence, initialOverview.setups]
  );

  const gapMeanVolume = useMemo(() => {
    const vs = initialOverview.gapIntelligence.map((g) => g.volume || 0).filter((v) => v > 0);
    if (!vs.length) return 1;
    return vs.reduce((a, b) => a + b, 0) / vs.length;
  }, [initialOverview.gapIntelligence]);

  const dayVolBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of initialOverview.gapIntelligence) {
      m.set(g.symbol, g.volume || 0);
    }
    return m;
  }, [initialOverview.gapIntelligence]);

  const rankedSetups = useMemo(() => {
    return [...initialOverview.setups]
      .filter((s) => typeof s.score === "number" && Number.isFinite(s.score))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }, [initialOverview.setups]);

  const confluenceAlertSymbols = useMemo(() => {
    const s = new Set<string>();
    for (const setup of initialOverview.setups) {
      if (setup.is_confluence_alert && setup.symbol) s.add(setup.symbol.trim().toUpperCase());
    }
    return s;
  }, [initialOverview.setups]);

  const gapSymbolsKey = useMemo(
    () => initialOverview.gapIntelligence.map((g) => g.symbol).join(","),
    [initialOverview.gapIntelligence]
  );

  const gapIntelGrouped = useMemo(() => {
    const items = [...initialOverview.gapIntelligence].sort(
      (a, b) => b.gap_quality_score - a.gap_quality_score
    );
    const withCat = items.filter((x) => x.has_catalyst);
    const without = items.filter((x) => !x.has_catalyst);
    return { withCat, without };
  }, [initialOverview.gapIntelligence]);

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
            <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>Quality</span>
            <span style={{ fontSize: typography.scale.xs, fontFamily: MONO }}>{item.gap_quality_score}</span>
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
                setGapNewsDrawerItem(item);
              }
            }}
            onClick={() => setGapNewsDrawerItem(item)}
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
        <div style={{ marginTop: spacing[2], display: "inline-flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
          <button
            type="button"
            onClick={() => void openGapEvidence(item)}
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              background: "transparent",
              color: colors.text,
              padding: `${spacing[1]} ${spacing[2]}`,
              cursor: "pointer",
              fontSize: typography.scale.xs
            }}
          >
            View Signal
          </button>
          <AddToWatchlistButton symbol={item.symbol} />
          <span title="ORB window has closed for today" style={{ display: "inline-flex" }}>
            <button
              type="button"
              onClick={() => {
                const sym = item.symbol.trim().toUpperCase();
                const setupFor = initialOverview.setups.find((s) => s.symbol.trim().toUpperCase() === sym);
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
                background: "rgba(59,130,246,0.15)",
                color: colors.accent,
                padding: `${spacing[1]} ${spacing[2]}`,
                cursor: "pointer",
                fontSize: typography.scale.xs
              }}
            >
              Open order entry
            </button>
          </span>
        </div>
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
        initialOverview.gapIntelligence.map(async (g) => {
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
  }, [gapSymbolsKey]);

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
    startTransition(() => {
      if (isUsRegularSessionOpenEt()) {
        nextScanRef.current = Date.now() + 5 * 60 * 1000;
      }
      router.refresh();
    });
  }, [router, startTransition]);

  const marketOpen = isUsRegularSessionOpenEt();
  const secondsToScan = Math.max(0, Math.ceil((nextScanRef.current - Date.now()) / 1000));
  const scanCountdownLabel = `${Math.floor(secondsToScan / 60)}:${String(secondsToScan % 60).padStart(2, "0")}`;

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

  const openGapEvidence = useCallback(
    async (item: GapIntelligenceItem) => {
      let symbolNewsArticles: Awaited<ReturnType<typeof fetchSymbolNews>> = [];
      try {
        symbolNewsArticles = await fetchSymbolNews(item.symbol, 10);
      } catch {
        symbolNewsArticles = [];
      }
      const risk = earningsRiskFor(item.symbol);
      const sym = item.symbol.trim().toUpperCase();
      const s = (await fetchSymbolSnapshot(sym)) ?? undefined;
      setEvidence(
        buildEvidenceFromSetup(gapSyntheticSetup(item), s, {
          symbolNewsArticles,
          earningsRiskDays: risk?.daysUntil,
          earningsReportTime: risk?.reportTime
        })
      );
      setEvidenceOpen(true);
    },
    [earningsBySymbol]
  );

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
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

      <div className="scanner-grid grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section
          className={`min-w-0 ${surfaceGlowClassName}`}
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2], marginBottom: spacing[2] }}>
            <h3 style={{ margin: 0 }}>Gap Intelligence</h3>
            <InfoTip text={GAP_INTELLIGENCE_TIP} label="About gap intelligence" />
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
            {initialOverview.gapIntelligence.length === 0 ? (
              <p style={{ margin: 0, color: colors.textMuted }}>No gap intelligence matches right now.</p>
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
            <h3 style={{ margin: 0 }}>Intraday Setups</h3>
            <InfoTip text={INTRADAY_SETUPS_TIP} label="About intraday setups" />
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
            {rankedSetups.length === 0 ? (
              <p style={{ margin: 0, color: colors.textMuted }}>No setups right now.</p>
            ) : (
              rankedSetups.map((setup, idx) => {
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
                            {Math.round(setup.score * 100)}%
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
                              signal_strength: String(Math.min(100, Math.max(0, Math.round(setup.score * 100)))),
                              signal_direction: setup.direction,
                              ...(setup.confluence_score != null
                                ? { confluence_score: String(Math.round(setup.confluence_score)) }
                                : {})
                            });
                          }}
                          style={{
                            border: `1px solid ${orbExpired ? "var(--color-border)" : colors.accent}`,
                            borderRadius: borderRadius.md,
                            background: orbExpired ? "var(--color-background-secondary)" : "rgba(59,130,246,0.15)",
                            color: orbExpired ? "var(--color-text-tertiary)" : colors.accent,
                            padding: `${spacing[1]} ${spacing[2]}`,
                            cursor: orbExpired ? "not-allowed" : "pointer",
                            fontSize: typography.scale.xs,
                            opacity: orbExpired ? 0.4 : 1
                          }}
                        >
                          Open order entry
                        </button>
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          let symbolNewsArticles: Awaited<ReturnType<typeof fetchSymbolNews>> = [];
                          try {
                            symbolNewsArticles = await fetchSymbolNews(setup.symbol, 10);
                          } catch {
                            symbolNewsArticles = [];
                          }
                          const risk = earningsRiskFor(setup.symbol);
                          const sym = setup.symbol.trim().toUpperCase();
                          const s = (await fetchSymbolSnapshot(sym)) ?? undefined;
                          setEvidence(
                            buildEvidenceFromSetup(setup, s, {
                              symbolNewsArticles,
                              earningsRiskDays: risk?.daysUntil,
                              earningsReportTime: risk?.reportTime
                            })
                          );
                          setEvidenceOpen(true);
                        }}
                        style={{
                          border: `1px solid ${colors.border}`,
                          borderRadius: borderRadius.md,
                          background: "transparent",
                          color: colors.text,
                          padding: `${spacing[1]} ${spacing[2]}`,
                          cursor: "pointer",
                          fontSize: typography.scale.xs
                        }}
                      >
                        View Evidence
                      </button>
                      <InfoTip text={SETUP_RELATIVE_VOLUME_TIP} label="Relative volume" />
                    </div>
                    <div style={{ position: "absolute", right: spacing[3], bottom: spacing[3] }}>
                      <SignalDisclaimerChip />
                    </div>
                  </motion.article>
                );
              })
            )}
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
      <SignalEvidenceModal open={evidenceOpen} evidence={evidence} onClose={() => setEvidenceOpen(false)} />
    </section>
  );
}
