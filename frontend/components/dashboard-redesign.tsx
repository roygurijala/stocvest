"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { DashboardCard } from "@/components/dashboard-card";
import { DashboardRealtime } from "@/components/dashboard-realtime";
import { DecisionMetric } from "@/components/decision-metric";
import { EarningsCalendar } from "@/components/earnings-calendar";
import { InfoTip } from "@/components/info-tip";
import { WeeklyMarketContextWidget, type WeeklyIndexRow } from "@/components/weekly-market-context-widget";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { NewsPanel } from "@/components/news-panel";
import { PdtStatusPill } from "@/components/pdt-status-pill";
import { getChangeColor } from "@/components/market-sentiment-score-widget";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchMacroContext } from "@/lib/api/fetch-macro-context";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import { topSignalStrengthPercent } from "@/lib/top-signal-strength";
import type { MarketOverview, NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type { IntradayGeoPreview, IntradaySetupPayload, ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import { earningsTimingLabel } from "@/lib/earnings-timing";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { buildEvidenceFromSetup, enrichEvidenceWithRealComposite, type SignalEvidenceData } from "@/lib/signal-evidence";
import { tickerNewsTriggerLine } from "@/lib/api/ticker-news-panel";
import {
  CONFIDENCE_PERCENT_TIP,
  CONFLUENCE_COUNT_DECISION_TIP,
  GEO_WEIGHTED_EXPOSURE_TIP,
  LAST_PRICE_SIGNAL_CARD_TIP,
  MARKET_PULSE_CARD_TIP,
  PORTFOLIO_ACTIVE_CARD_TIP,
  QQQ_PULSE_NUMBER_TIP,
  REGIME_BADGE_TIP,
  SECTOR_ROTATION_CARD_TIP,
  SESSION_STATUS_STRIP_TIP,
  SPY_PULSE_NUMBER_TIP,
  TOP_SIGNAL_ROW_CARD_TIP,
  TOP_SIGNALS_CARD_TIP,
  UPCOMING_CATALYSTS_CARD_TIP,
  VIX_PULSE_NUMBER_TIP,
  WEEKLY_MARKET_CONTEXT_CARD_TIP
} from "@/lib/ui-tooltips";
import { buildDashboardSignalCardStrip } from "@/lib/dashboard-signal-card-strip";
import Link from "next/link";

export type { WeeklyIndexRow } from "@/components/weekly-market-context-widget";

export type SectorRotationChip = { symbol: string; label: string; pct5d: number | null };

export type PortfolioActiveRow = {
  symbol: string;
  side: string;
  entry: number;
  last: number | null;
  pnlDollars: number | null;
};

interface DashboardRedesignProps {
  marketOverview: MarketOverview;
  pdtStatus: PDTStatusPayload | null;
  scannerOverview: ScannerOverview;
  earningsEvents: EarningsEvent[];
  earningsRecent: EarningsEvent[];
  weeklyIndexRows: WeeklyIndexRow[];
  sectorRotation: SectorRotationChip[];
  portfolioActive: PortfolioActiveRow[];
}

function SkeletonLine({ width = "100%", height = 14 }: { width?: string; height?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 8,
        background: "linear-gradient(90deg, rgba(148,163,184,0.15), rgba(148,163,184,0.28), rgba(148,163,184,0.15))",
        backgroundSize: "180% 100%",
        animation: "stocvest-skeleton 1.2s ease-in-out infinite"
      }}
    />
  );
}

function TopSignalGeoStrip({ preview, colors }: { preview: IntradayGeoPreview; colors: ThemeColors }) {
  const band = (preview.exposure_band || "low").toLowerCase();
  const bandStyles =
    band === "high"
      ? { fg: colors.bearish, bg: "rgba(239,68,68,0.11)", border: "rgba(239,68,68,0.38)" }
      : band === "moderate"
        ? { fg: colors.caution, bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.42)" }
        : { fg: colors.bullish, bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.38)" };
  const scoreStr =
    preview.weighted_score != null && Number.isFinite(preview.weighted_score)
      ? preview.weighted_score.toFixed(2)
      : null;
  return (
    <div
      style={{
        borderRadius: borderRadius.md,
        border: `1px solid ${bandStyles.border}`,
        background: bandStyles.bg,
        padding: `${spacing[2]} ${spacing[2]}`,
        display: "grid",
        gap: spacing[1]
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: colors.text }}>{preview.impact_sector_label}</span>
        <span
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 700,
            textTransform: "capitalize",
            color: bandStyles.fg,
            padding: "2px 8px",
            borderRadius: borderRadius.full,
            border: `1px solid ${bandStyles.border}`,
            background: "rgba(255,255,255,0.04)"
          }}
        >
          Geo {band}
        </span>
      </div>
      {scoreStr ? (
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
          Weighted exposure{" "}
          <DecisionMetric explanation={GEO_WEIGHTED_EXPOSURE_TIP} label="How weighted geo exposure is used" maxWidth={280}>
            <span>{scoreStr}</span>
          </DecisionMetric>
        </span>
      ) : null}
      {preview.theme_tags && preview.theme_tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {preview.theme_tags.map((t, ti) => (
            <span
              key={`${ti}-${t}`}
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: colors.textMuted,
                padding: "2px 6px",
                borderRadius: borderRadius.sm,
                border: `1px solid ${colors.border}`,
                background: "rgba(255,255,255,0.04)"
              }}
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {preview.summary ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>{preview.summary}</p>
      ) : null}
    </div>
  );
}

function toPrice(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "";
  return `$${n.toFixed(2)}`;
}

function findVixSnapshot(snapshots: SnapshotPayload[]): SnapshotPayload | undefined {
  const order = ["I:VIX", "^VIX", "VIX"];
  for (const k of order) {
    const hit = snapshots.find((x) => (x.symbol || "").toUpperCase() === k);
    if (hit) return hit;
  }
  return undefined;
}

/** Session change % for pulse widgets (aligns with scanner `snapPct`: regular → pre → after → derived). */
function snapshotSessionChangePct(s: SnapshotPayload | null | undefined): number | null {
  if (!s) return null;
  const clean = (v: number | null | undefined): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    if (v <= -99.5) return null;
    return v;
  };
  const c = s.change_percent;
  if (clean(c) != null) return clean(c);
  const pre = s.pre_market_change_percent;
  if (clean(pre) != null) return clean(pre);
  const ah = s.after_hours_change_percent;
  if (clean(ah) != null) return clean(ah);
  const last = s.last_trade_price;
  const prev = s.prev_close;
  if (
    typeof last === "number" &&
    typeof prev === "number" &&
    Number.isFinite(last) &&
    Number.isFinite(prev) &&
    prev !== 0
  ) {
    return clean(((last - prev) / prev) * 100);
  }
  return null;
}

/** Same thresholds as `frontend/lib/api/scanner.ts` regime label. */
function regimeFromSpyQqq(spyPct: number | null, qqqPct: number | null, fallback: string): string {
  if (spyPct != null && qqqPct != null) {
    if (spyPct > 0.2 && qqqPct > 0.15) return "Bullish";
    if (spyPct < -0.2 || qqqPct < -0.25) return "Bearish";
    return "Neutral";
  }
  return fallback;
}

function pulseRegimeColor(regime: string, colors: ThemeColors): string {
  const r = regime.trim().toLowerCase();
  if (r === "bullish") return colors.bullish;
  if (r === "bearish") return colors.bearish;
  return colors.caution;
}

export function DashboardRedesign({
  marketOverview,
  pdtStatus,
  scannerOverview,
  earningsEvents,
  earningsRecent,
  weeklyIndexRows,
  sectorRotation,
  portfolioActive
}: DashboardRedesignProps) {
  const { colors } = useTheme();
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [newsPanelSymbol, setNewsPanelSymbol] = useState("");
  const [newsPanelOpen, setNewsPanelOpen] = useState(false);
  const [newsUiTick, setNewsUiTick] = useState(0);
  const [macroPulse, setMacroPulse] = useState<Awaited<ReturnType<typeof fetchMacroContext>>>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMacroContext().then((ctx) => {
      if (!cancelled) {
        setMacroPulse(ctx);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const snapshotsBySymbol = useMemo(
    () => new Map(marketOverview.snapshots.map((s) => [(s.symbol || "").toUpperCase(), s])),
    [marketOverview.snapshots]
  );
  const swingTopSignals = useMemo(
    () => scannerOverview.setups.filter((s) => s.scanner_mode === "swing_daily"),
    [scannerOverview.setups]
  );
  const topSignals = swingTopSignals.slice(0, 3);
  const pdt = pdtStatus?.assessment;
  const vixSnapshot =
    findVixSnapshot(marketOverview.snapshots) ||
    snapshotsBySymbol.get("I:VIX") ||
    snapshotsBySymbol.get("VIX") ||
    snapshotsBySymbol.get("^VIX");
  const earningsBySymbol = useMemo(() => {
    const m = new Map<string, EarningsEvent>();
    for (const e of earningsRecent) {
      m.set(e.symbol.trim().toUpperCase(), e);
    }
    for (const e of earningsEvents) {
      m.set(e.symbol.trim().toUpperCase(), e);
    }
    return m;
  }, [earningsEvents, earningsRecent]);
  const spyFromScanner =
    typeof scannerOverview.spyPct === "number" &&
    Number.isFinite(scannerOverview.spyPct) &&
    scannerOverview.spyPct > -99.5
      ? scannerOverview.spyPct
      : null;
  const qqqFromScanner =
    typeof scannerOverview.qqqPct === "number" &&
    Number.isFinite(scannerOverview.qqqPct) &&
    scannerOverview.qqqPct > -99.5
      ? scannerOverview.qqqPct
      : null;
  const spyPct = spyFromScanner ?? snapshotSessionChangePct(snapshotsBySymbol.get("SPY"));
  const qqqPct = qqqFromScanner ?? snapshotSessionChangePct(snapshotsBySymbol.get("QQQ"));
  const useScannerRegime =
    !scannerOverview.error && spyFromScanner != null && qqqFromScanner != null;
  const regimeLabel = useScannerRegime
    ? (scannerOverview.regimeLabel ?? "Neutral")
    : regimeFromSpyQqq(spyPct, qqqPct, scannerOverview.regimeLabel ?? "Neutral");
  const vixPct = snapshotSessionChangePct(vixSnapshot);

  const newsLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of swingTopSignals.slice(0, 3)) {
      m.set(s.symbol.trim().toUpperCase(), tickerNewsTriggerLine(s.symbol, 120));
    }
    return m;
  }, [swingTopSignals, newsUiTick]);

  const upcomingCatalystWeek = useMemo(
    () => [...earningsEvents].sort((a, b) => a.report_date.localeCompare(b.report_date)).slice(0, 10),
    [earningsEvents]
  );

  const macroRiskLevel = (macroPulse?.macro_risk_level ?? macroPulse?.macro_risk ?? "low").toLowerCase();
  const macroWarnings = macroPulse?.warnings ?? [];

  return (
    <section className="stocvest-dashboard-v2" style={{ display: "grid", gap: spacing[5] }}>
      <article
        style={{
          borderBottom: `1px solid color-mix(in srgb, ${colors.border} 80%, ${colors.accent} 20%)`,
          paddingBottom: spacing[4],
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: spacing[3],
          background: `linear-gradient(90deg, color-mix(in srgb, ${colors.accent} 5%, transparent) 0%, transparent 55%)`
        }}
      >
        <div className="min-w-0" style={{ display: "grid", gap: spacing[3] }}>
          <div
            className="min-w-0 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ display: "flex", gap: spacing[3], flexWrap: "nowrap", alignItems: "center", fontSize: typography.scale.sm }}
          >
            <span style={{ color: colors.textMuted }}>
              <strong style={{ color: colors.text }}>Market</strong>{" "}
              {marketOverview.status ? (
                <span
                  style={{
                    color:
                      marketOverview.status.market?.toLowerCase() === "open" ? colors.bullish : colors.textMuted
                  }}
                >
                  {marketOverview.status.market?.toLowerCase() === "open" ? "Open" : "Closed"}
                </span>
              ) : !marketOverview.error ? (
                <SkeletonLine width="64px" />
              ) : null}
            </span>
            {vixSnapshot ? (
              <span style={{ color: colors.textMuted }}>
                <strong style={{ color: colors.text }}>VIX</strong> {toPrice(vixSnapshot.last_trade_price)}
              </span>
            ) : null}
            <PdtStatusPill assessment={pdt ?? null} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DashboardRealtime />
          <InfoTip text={SESSION_STATUS_STRIP_TIP} label="About the session status strip" maxWidth={300} />
        </div>
      </article>

      <div className="dashboard-grid grid grid-cols-1 gap-5 lg:grid-cols-[7fr_13fr] lg:items-stretch [&>*]:min-w-0">
          <div className="order-1 min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <DashboardCard
              eyebrow="Swing desk"
              title="Weekly market context"
              subtitle="SPY, QQQ, and IWM — last ~5 trading sessions (daily closes), not intraday tape."
              cardTip={WEEKLY_MARKET_CONTEXT_CARD_TIP}
            >
              <WeeklyMarketContextWidget rows={weeklyIndexRows} marketStatus={marketOverview.status} />
            </DashboardCard>
          </div>

          <DashboardCard
            className={`order-2 flex w-full min-h-[200px] flex-col overflow-hidden lg:self-start lg:col-start-1 lg:row-start-2`}
            title="Top signals"
            eyebrow="Scanner"
            subtitle="Daily swing scanner only (no intraday session patterns on the dashboard). Open Evidence for the six-layer read, macro–sector–technical alignment, and levels."
            cardTip={TOP_SIGNALS_CARD_TIP}
          >
            <div className="flex flex-col gap-3">
              {topSignals.length === 0 ? (
                <div className="flex flex-col justify-center gap-3 py-4" style={{ padding: spacing[2] }}>
                  {scannerOverview.error ? (
                    <p style={{ margin: 0, color: colors.textMuted }}>{scannerOverview.error}</p>
                  ) : (
                    <>
                      <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.55 }}>
                        No active swing setups right now.
                      </p>
                      <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.55, fontSize: typography.scale.sm }}>
                        The daily scanner runs each morning and surfaces setups when conditions align across price structure,
                        volume, and weekly momentum.
                      </p>
                      <p style={{ margin: 0, color: colors.textMuted, lineHeight: 1.55, fontSize: typography.scale.sm }}>
                        Check back at market open or run the full Scanner for intraday lists and detail.
                      </p>
                      <Link
                        href="/dashboard/scanner"
                        className="inline-flex min-h-11 items-center font-semibold"
                        style={{ color: colors.accent, fontSize: typography.scale.sm }}
                      >
                        Open Scanner →
                      </Link>
                    </>
                  )}
                </div>
              ) : (
                topSignals.map((signal, idx) => {
                  const snapRow = snapshotsBySymbol.get(signal.symbol.trim().toUpperCase());
                  const strip = buildDashboardSignalCardStrip(signal, snapRow, {
                    upcoming: earningsEvents,
                    recent: earningsRecent
                  });
                  const tier = (signal.confluence_tier || "").trim().toLowerCase();
                  const nConf = typeof signal.n_confirming === "number" ? signal.n_confirming : signal.confirming_signals?.length;
                  const nConfl =
                    typeof signal.n_conflicting === "number" ? signal.n_conflicting : signal.conflicting_signals?.length;

                  return (
                  <motion.article
                    key={`${signal.symbol}-${idx}`}
                    className={`flex flex-col gap-2 ${surfaceGlowClassName}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.08 }}
                    style={{
                      position: "relative",
                      background: `linear-gradient(160deg, color-mix(in srgb, ${colors.accent} 6%, ${colors.surfaceMuted}) 0%, ${colors.surfaceMuted} 100%)`,
                      border: `1px solid color-mix(in srgb, ${colors.border} 88%, ${colors.accent} 12%)`,
                      borderRadius: borderRadius.lg,
                      padding: spacing[3],
                      paddingTop: `calc(${spacing[3]} + 4px)`,
                      paddingRight: `calc(${spacing[3]} + 28px)`
                    }}
                  >
                    <div style={{ position: "absolute", top: spacing[2], right: spacing[2], zIndex: 1 }}>
                      <InfoTip text={TOP_SIGNAL_ROW_CARD_TIP} label="About this signal row" maxWidth={300} />
                    </div>
                    <div className="flex flex-col gap-2">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: spacing[2] }}>
                        <div style={{ display: "flex", alignItems: "center", gap: spacing[2], minWidth: 0, flexWrap: "wrap" }}>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: typography.scale.base }}>{signal.symbol}</p>
                          <span
                            style={{
                              background: ["bullish", "long"].includes(signal.direction.toLowerCase())
                                ? "rgba(34,197,94,.2)"
                                : "rgba(239,68,68,.2)",
                              color: ["bullish", "long"].includes(signal.direction.toLowerCase()) ? colors.bullish : colors.bearish,
                              borderRadius: borderRadius.full,
                              padding: "2px 8px",
                              fontSize: typography.scale.xs,
                              fontWeight: 600,
                              textTransform: "lowercase"
                            }}
                          >
                            {signal.direction}
                          </span>
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                          <DecisionMetric explanation={CONFIDENCE_PERCENT_TIP} label="How signal strength is used" maxWidth={300}>
                            <span style={{ color: colors.text, fontSize: typography.scale.sm, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                              {topSignalStrengthPercent(signal)}%
                            </span>
                          </DecisionMetric>
                        </div>
                      </div>
                      {signal.company_name?.trim() ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.35 }}>
                          {signal.company_name.trim()}
                        </p>
                      ) : null}
                      {typeof signal.last_price === "number" && Number.isFinite(signal.last_price) ? (
                        <p
                          style={{
                            margin: 0,
                            fontSize: typography.scale.xs,
                            color: colors.textMuted,
                            fontVariantNumeric: "tabular-nums"
                          }}
                        >
                          Last{" "}
                          <DecisionMetric explanation={LAST_PRICE_SIGNAL_CARD_TIP} label="How last price is used" maxWidth={280}>
                            <span style={{ color: colors.text, fontWeight: 600 }}>${signal.last_price.toFixed(2)}</span>
                          </DecisionMetric>
                        </p>
                      ) : null}
                      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.45, fontWeight: 600 }}>
                        {strip.patternLine}
                      </p>
                      {strip.swingDailyDetailLine ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
                          {strip.swingDailyDetailLine}
                        </p>
                      ) : null}
                      {strip.entryZoneLine ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.text, fontVariantNumeric: "tabular-nums" }}>
                          {strip.entryZoneLine}
                        </p>
                      ) : null}
                      {strip.stopTargetLine ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, fontVariantNumeric: "tabular-nums" }}>
                          {strip.stopTargetLine}
                        </p>
                      ) : null}
                      {strip.maturityLine ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>{strip.maturityLine}</p>
                      ) : null}
                      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.45 }}>
                        <strong>Catalyst:</strong> {strip.catalystLine}
                      </p>
                      {signal.geo_preview ? <TopSignalGeoStrip preview={signal.geo_preview} colors={colors} /> : null}
                      {tier || nConf != null || nConfl != null ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
                          {tier ? (
                            <>
                              <span style={{ textTransform: "capitalize", color: colors.text }}>{tier}</span> confluence
                            </>
                          ) : (
                            <span style={{ color: colors.text }}>Confluence</span>
                          )}
                          {nConf != null || (nConfl != null && nConfl > 0) ? (
                            <>
                              {" "}
                              <DecisionMetric explanation={CONFLUENCE_COUNT_DECISION_TIP} label="How confluence counts are used" maxWidth={300}>
                                <span style={{ color: colors.textMuted }}>
                                  {nConf != null ? <>· {nConf} aligning</> : null}
                                  {nConfl != null && nConfl > 0 ? (
                                    <>
                                      {" "}
                                      · {nConfl} conflict{nConfl === 1 ? "" : "s"}
                                    </>
                                  ) : null}
                                </span>
                              </DecisionMetric>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        className="w-full text-left"
                        style={{
                          margin: 0,
                          padding: `${spacing[1]} 0`,
                          fontSize: typography.scale.xs,
                          color: colors.textMuted,
                          cursor: "pointer",
                          background: "none",
                          border: "none"
                        }}
                        onClick={() => {
                          setNewsPanelSymbol(signal.symbol.trim().toUpperCase());
                          setNewsPanelOpen(true);
                        }}
                      >
                        {newsLabels.get(signal.symbol.trim().toUpperCase()) ?? tickerNewsTriggerLine(signal.symbol)}
                      </button>
                      <div
                        className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between"
                        style={{ borderTopColor: colors.border }}
                      >
                        <button
                          type="button"
                          className="min-h-11 w-full text-sm font-semibold sm:w-auto"
                          onClick={async () => {
                            const sym = signal.symbol.trim().toUpperCase();
                            let snapshot = snapshotsBySymbol.get(sym);
                            if (!snapshot) {
                              snapshot = (await fetchSymbolSnapshot(sym)) ?? undefined;
                            }
                            let symbolNewsArticles: NewsPayload[] = [];
                            try {
                              symbolNewsArticles = await fetchSymbolNews(signal.symbol, 10, {
                                newsTradingMode: "swing"
                              });
                            } catch {
                              symbolNewsArticles = [];
                            }
                            const event = earningsBySymbol.get(signal.symbol.toUpperCase());
                            const today = new Date().toISOString().slice(0, 10);
                            const daysUntil =
                              event != null
                                ? Math.floor(
                                    (Date.parse(`${event.report_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
                                  )
                                : undefined;
                            const base = buildEvidenceFromSetup(signal, snapshot, {
                              symbolNewsArticles,
                              earningsRiskDays: typeof daysUntil === "number" ? daysUntil : undefined,
                              earningsReportTime: event?.report_time
                            });
                            setEvidence(await enrichEvidenceWithRealComposite(base));
                            setEvidenceOpen(true);
                          }}
                          style={{
                            border: `1px solid color-mix(in srgb, ${colors.accent} 55%, ${colors.border})`,
                            borderRadius: borderRadius.md,
                            background: `linear-gradient(135deg, color-mix(in srgb, ${colors.accent} 28%, transparent), color-mix(in srgb, ${colors.accent} 12%, transparent))`,
                            color: colors.accent,
                            padding: `${spacing[2]} ${spacing[3]}`,
                            cursor: "pointer",
                            alignSelf: "flex-start",
                            boxShadow: `0 0 0 1px color-mix(in srgb, ${colors.accent} 18%, transparent)`
                          }}
                        >
                          View Evidence
                        </button>
                        <div className="flex flex-wrap items-center justify-start sm:justify-end">
                          <SignalDisclaimerChip />
                        </div>
                      </div>
                    </div>
                  </motion.article>
                  );
                })
              )}
            </div>
          </DashboardCard>

          <div className="order-3 flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2">
          <DashboardCard
            className="flex min-h-[200px] flex-col overflow-hidden lg:self-start"
            eyebrow="Tape"
            title="Market pulse"
            subtitle="SPY · QQQ · VIX session change and regime — today’s tape versus your swing read. Numbers match the scanner when it completes; otherwise they come from your overview snapshots."
            cardTip={MARKET_PULSE_CARD_TIP}
          >
            <div className="flex flex-col gap-3 text-sm" style={{ color: colors.text }}>
              <div
                className="flex flex-wrap gap-x-4 gap-y-2 font-semibold"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <span>
                  SPY{" "}
                  <span style={{ color: spyPct != null ? getChangeColor(spyPct, colors) : colors.textMuted }}>
                    {spyPct != null ? (
                      <DecisionMetric explanation={SPY_PULSE_NUMBER_TIP} label="How SPY change is used" maxWidth={280}>
                        <span>{`${spyPct >= 0 ? "+" : ""}${spyPct.toFixed(2)}%`}</span>
                      </DecisionMetric>
                    ) : (
                      "—"
                    )}
                  </span>
                </span>
                <span>
                  QQQ{" "}
                  <span style={{ color: qqqPct != null ? getChangeColor(qqqPct, colors) : colors.textMuted }}>
                    {qqqPct != null ? (
                      <DecisionMetric explanation={QQQ_PULSE_NUMBER_TIP} label="How QQQ change is used" maxWidth={280}>
                        <span>{`${qqqPct >= 0 ? "+" : ""}${qqqPct.toFixed(2)}%`}</span>
                      </DecisionMetric>
                    ) : (
                      "—"
                    )}
                  </span>
                </span>
                <span>
                  VIX{" "}
                  <span style={{ color: vixPct != null ? getChangeColor(vixPct, colors) : colors.textMuted }}>
                    {vixPct != null ? (
                      <DecisionMetric explanation={VIX_PULSE_NUMBER_TIP} label="How VIX move is used" maxWidth={280}>
                        <span>{`${vixPct > 0.05 ? "▲" : vixPct < -0.05 ? "▼" : "→"} ${vixPct >= 0 ? "+" : ""}${vixPct.toFixed(2)}%`}</span>
                      </DecisionMetric>
                    ) : vixSnapshot?.last_trade_price != null ? (
                      <DecisionMetric explanation={VIX_PULSE_NUMBER_TIP} label="How VIX level is used" maxWidth={280}>
                        <span>→ {Number(vixSnapshot.last_trade_price).toFixed(2)}</span>
                      </DecisionMetric>
                    ) : (
                      "—"
                    )}
                  </span>
                </span>
              </div>
              <DecisionMetric explanation={REGIME_BADGE_TIP} label="How regime label is used" maxWidth={300}>
                <div
                  className="inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide"
                  style={{
                    borderColor: colors.border,
                    background: "rgba(148,163,184,0.08)",
                    color: pulseRegimeColor(regimeLabel, colors)
                  }}
                >
                  Regime: {regimeLabel}
                </div>
              </DecisionMetric>
              <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
                Session tape for context; swing thesis uses weekly panel + Evidence.
              </p>
              {(macroRiskLevel === "critical" || macroRiskLevel === "elevated") && macroWarnings.length > 0 ? (
                <div
                  className={
                    macroRiskLevel === "critical"
                      ? "mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
                      : "mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400"
                  }
                >
                  {macroWarnings[0]}
                </div>
              ) : null}
            </div>
          </DashboardCard>

          <DashboardCard
            eyebrow="Sectors"
            title="Sector rotation (5 sessions)"
            subtitle="Where equity flows clustered over the last week of daily closes."
            cardTip={SECTOR_ROTATION_CARD_TIP}
          >
            <div className="flex flex-wrap gap-2" style={{ fontSize: typography.scale.sm, fontVariantNumeric: "tabular-nums" }}>
              {sectorRotation.map((s) => (
                <span
                  key={s.symbol}
                  style={{
                    borderRadius: borderRadius.md,
                    border: `1px solid ${colors.border}`,
                    padding: `${spacing[1]} ${spacing[2]}`,
                    color: colors.text
                  }}
                >
                  <strong>{s.symbol}</strong>{" "}
                  <span style={{ color: s.pct5d != null ? getChangeColor(s.pct5d, colors) : colors.textMuted }}>
                    {s.pct5d != null ? `${s.pct5d >= 0 ? "+" : ""}${s.pct5d.toFixed(1)}%` : "—"}
                  </span>
                  <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}> · {s.label}</span>
                </span>
              ))}
            </div>
          </DashboardCard>

          <DashboardCard
            eyebrow="Catalysts"
            title="Upcoming events this week"
            subtitle="Earnings on your dashboard symbol list (same feed as the calendar below)."
            cardTip={UPCOMING_CATALYSTS_CARD_TIP}
          >
            {upcomingCatalystWeek.length === 0 ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>No upcoming dates in range.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: spacing[4], color: colors.text, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
                {upcomingCatalystWeek.map((e) => (
                  <li key={`${e.symbol}-${e.report_date}`}>
                    <strong>{e.symbol}</strong> · {earningsTimingLabel(e.report_time)} · {e.report_date.slice(5).replace("-", "/")}
                    {e.company_name ? (
                      <span style={{ color: colors.textMuted }}> — {e.company_name}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard
            eyebrow="Signal portfolio"
            title="Active positions"
            subtitle="Model book marks — not your brokerage."
            cardTip={PORTFOLIO_ACTIVE_CARD_TIP}
          >
            <div className="mb-2">
              <Link href="/portfolio" style={{ fontSize: typography.scale.xs, color: colors.accent, fontWeight: 600 }}>
                Open full portfolio →
              </Link>
            </div>
            {portfolioActive.length === 0 ? (
              <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>No open tracked positions.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: spacing[4], color: colors.text, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
                {portfolioActive.map((p) => {
                  const lastStr = p.last != null && Number.isFinite(p.last) ? `$${p.last.toFixed(2)}` : "—";
                  const pnlStr =
                    p.pnlDollars != null && Number.isFinite(p.pnlDollars)
                      ? `${p.pnlDollars >= 0 ? "+" : ""}$${Math.abs(p.pnlDollars).toFixed(0)}`
                      : null;
                  return (
                    <li key={`${p.symbol}-${p.entry}`}>
                      <strong>{p.symbol}</strong> {p.side} · Entry ${p.entry.toFixed(2)} · Now {lastStr}
                      {pnlStr ? <span style={{ color: p.pnlDollars! >= 0 ? colors.bullish : colors.bearish }}> · {pnlStr}</span> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </DashboardCard>
          </div>

          <EarningsCalendar
            className="order-4 lg:col-span-2 lg:col-start-1 lg:row-start-3"
            events={earningsEvents}
            title="Upcoming Earnings (Next 7 Days)"
            maxDays={7}
          />
      </div>

      <SignalEvidenceModal
        open={evidenceOpen}
        evidence={evidence}
        onClose={() => setEvidenceOpen(false)}
        onOpenNewsPanel={(sym) => {
          setNewsPanelSymbol(sym.trim().toUpperCase());
          setNewsPanelOpen(true);
        }}
      />
      <NewsPanel
        symbol={newsPanelSymbol}
        isOpen={newsPanelOpen}
        newsTradingMode="swing"
        onClose={() => {
          setNewsPanelOpen(false);
          setNewsUiTick((t) => t + 1);
        }}
        onLoaded={() => setNewsUiTick((t) => t + 1)}
      />
    </section>
  );
}
