"use client";

import { type ReactNode, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { DashboardRealtime } from "@/components/dashboard-realtime";
import { EarningsCalendar } from "@/components/earnings-calendar";
import { InfoTip } from "@/components/info-tip";
import { MarketSentimentScoreWidget } from "@/components/market-sentiment-score-widget";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";
import { MorningBriefCollapse } from "@/components/morning-brief-collapse";
import { PdtStatusPill } from "@/components/pdt-status-pill";
import { NewsHeadlineDrawer } from "@/components/news-headline-drawer";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import { fetchSymbolSnapshot } from "@/lib/api/fetch-symbol-snapshot";
import type { MarketOverview, NewsCredibilityBand, NewsIntelCategory, NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type { IntradayGeoPreview, IntradaySetupPayload, ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { buildEvidenceFromSetup, enrichEvidenceWithRealComposite, type SignalEvidenceData } from "@/lib/signal-evidence";
import { CONFIDENCE_PERCENT_TIP, LATEST_HEADLINES_TIP, TOP_SIGNALS_TIP } from "@/lib/ui-tooltips";

interface DashboardRedesignProps {
  marketOverview: MarketOverview;
  pdtStatus: PDTStatusPayload | null;
  scannerOverview: ScannerOverview;
  earningsEvents: EarningsEvent[];
  /** When set (e.g. Suspense-wrapped server fetch), shown in the morning-brief slot instead of `scannerOverview.morningBrief`. */
  morningBriefSlot?: ReactNode;
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
          Weighted exposure {scoreStr}
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

function topSignalStrengthPercent(setup: IntradaySetupPayload): number {
  const patPct =
    typeof setup.score === "number" && Number.isFinite(setup.score)
      ? Math.max(0, Math.min(100, setup.score * 100))
      : 0;
  if (typeof setup.confluence_score === "number" && Number.isFinite(setup.confluence_score)) {
    const conf = Math.max(0, Math.min(100, setup.confluence_score));
    const blended = conf * 0.78 + patPct * 0.22;
    return Math.max(0, Math.min(100, Math.round(blended)));
  }
  return Math.max(0, Math.min(100, Math.round(patPct)));
}

function toPrice(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "";
  return `$${n.toFixed(2)}`;
}

function isMorningBriefingWindowNow(): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  const minutes = hour * 60 + minute;
  return minutes >= 7 * 60 + 45 && minutes <= 10 * 60;
}

function timeAgo(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "now";
  const delta = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

type MiTab = "all" | "watchlist" | "earnings" | "analyst" | "macro";

const MI_TAB_DEFS: { id: MiTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "watchlist", label: "Watchlist" },
  { id: "earnings", label: "Earnings" },
  { id: "analyst", label: "Analyst" },
  { id: "macro", label: "Macro" }
];

const CATEGORY_ICONS: Record<string, { icon: string; color: string }> = {
  earnings: { icon: "📊", color: "#00E07A" },
  analyst: { icon: "🏦", color: "#00C8DC" },
  macro: { icon: "🌍", color: "#F5B800" },
  merger: { icon: "🤝", color: "#A855F7" },
  breaking: { icon: "🔴", color: "#FF3358" },
  sector: { icon: "⚙️", color: "#94A3B8" },
  general: { icon: "📰", color: "#64748B" }
};

function articleIntelCategory(article: NewsPayload): NewsIntelCategory {
  if (article.category) return article.category;
  const c = article.catalyst_category;
  if (c === "ma") return "merger";
  if (c === "fda" || c === "sector") return "sector";
  if (c === "earnings" || c === "analyst" || c === "macro" || c === "general") return c;
  return "general";
}

function articleMatchesMiTab(article: NewsPayload, tab: MiTab): boolean {
  const cat = articleIntelCategory(article);
  if (tab === "all") return true;
  if (tab === "watchlist") {
    return Boolean(article.affected_stocks?.some((s) => s.is_watchlist));
  }
  if (tab === "earnings") return cat === "earnings";
  if (tab === "analyst") return cat === "analyst";
  if (tab === "macro") return cat === "macro" || cat === "breaking";
  return false;
}

function miEmptyMessage(tab: MiTab): string {
  switch (tab) {
    case "earnings":
      return "No earnings news in the last 8 hours.";
    case "analyst":
      return "No analyst action headlines in the last 8 hours.";
    case "macro":
      return "No macro headlines in the last 8 hours.";
    case "watchlist":
      return "Add stocks to your default watchlist to see personalized news in this feed.";
    default:
      return "No headlines in this category right now. Try another tab.";
  }
}

function sourceLineStyle(article: NewsPayload, colors: { textMuted: string }) {
  const band = article.credibility?.band;
  if (band === "pr_wire") {
    return { color: colors.textMuted, opacity: 0.72 } as const;
  }
  if (band === "elite" || band === "major") {
    return { color: "#00d4ff", opacity: 1 } as const;
  }
  return { color: article.publisher?.tier === 1 ? "#00d4ff" : "#4a6080", opacity: 1 } as const;
}

function credibilityChipStyle(
  band: NewsCredibilityBand | undefined,
  colors: { border: string; textMuted: string; caution: string; surfaceMuted: string }
) {
  switch (band) {
    case "elite":
      return { backgroundColor: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.35)", color: "#00d4ff" };
    case "major":
      return { backgroundColor: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.35)", color: "#60a5fa" };
    case "trade":
      return { backgroundColor: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.3)", color: "#c084fc" };
    case "research":
      return { backgroundColor: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.35)", color: colors.caution };
    case "pr_wire":
      return { backgroundColor: "rgba(251,113,133,0.1)", border: "1px solid rgba(251,113,133,0.35)", color: "#fb7185" };
    default:
      return {
        backgroundColor: colors.surfaceMuted,
        border: `1px solid ${colors.border}`,
        color: colors.textMuted
      };
  }
}

export function DashboardRedesign({
  marketOverview,
  pdtStatus,
  scannerOverview,
  earningsEvents,
  morningBriefSlot
}: DashboardRedesignProps) {
  const { colors } = useTheme();
  const router = useRouter();
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [headlineArticle, setHeadlineArticle] = useState<NewsPayload | null>(null);
  const [miTab, setMiTab] = useState<MiTab>("all");
  const snapshotsBySymbol = new Map(marketOverview.snapshots.map((s) => [s.symbol, s]));
  const morningVisible =
    isMorningBriefingWindowNow() && (!!scannerOverview.morningBrief || morningBriefSlot != null);
  const topSignals = scannerOverview.setups.slice(0, 3);
  const pdt = pdtStatus?.assessment;
  const vixSnapshot = snapshotsBySymbol.get("VIX") || snapshotsBySymbol.get("^VIX");
  const earningsBySymbol = new Map(earningsEvents.map((e) => [e.symbol.toUpperCase(), e] as const));

  const filteredMiNews = useMemo(
    () => marketOverview.news.filter((a) => articleMatchesMiTab(a, miTab)),
    [marketOverview.news, miTab]
  );

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      <article
        style={{
          borderBottom: `1px solid ${colors.border}`,
          paddingBottom: spacing[3],
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: spacing[3]
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
        <DashboardRealtime />
      </article>

      <div className="dashboard-grid grid grid-cols-1 gap-4 lg:grid-cols-[7fr_13fr] lg:items-stretch [&>*]:min-w-0">
          <div className="order-1 min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <MarketSentimentScoreWidget marketOverview={marketOverview} />
            <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
              Blend of tape tone from SPY, QQQ, and IWM snapshots. Use as a quick pulse, not trade advice.
            </p>
          </div>

          <article
            className={`order-2 flex w-full min-h-[200px] flex-col overflow-hidden lg:self-start lg:col-start-1 lg:row-start-2 ${surfaceGlowClassName}`}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[4]
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: spacing[2],
                flexShrink: 0,
                marginBottom: spacing[2]
              }}
            >
              <h3 style={{ margin: 0 }}>Top Signals</h3>
              <InfoTip text={TOP_SIGNALS_TIP} label="About top signals" />
            </div>
            <div className="flex flex-col gap-3">
              {topSignals.length === 0 ? (
                <div className="flex flex-col justify-center py-4" style={{ padding: spacing[2] }}>
                  {scannerOverview.error ? (
                    <p style={{ margin: 0, color: colors.textMuted }}>{scannerOverview.error}</p>
                  ) : (
                    <p style={{ margin: 0, color: colors.textMuted }}>
                      Intelligence engine is warming up. Check back at market open.
                    </p>
                  )}
                </div>
              ) : (
                topSignals.map((signal, idx) => {
                  const triggersLine = signal.triggers
                    .map((t) => String(t).trim())
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(" · ");
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
                      background: colors.surfaceMuted,
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.lg,
                      padding: spacing[3]
                    }}
                  >
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
                          <span style={{ color: colors.text, fontSize: typography.scale.sm, fontWeight: 600 }}>
                            {topSignalStrengthPercent(signal)}%
                          </span>
                          <InfoTip text={CONFIDENCE_PERCENT_TIP} label="About signal strength" />
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
                          Last <span style={{ color: colors.text, fontWeight: 600 }}>${signal.last_price.toFixed(2)}</span>
                        </p>
                      ) : null}
                      {signal.geo_preview ? <TopSignalGeoStrip preview={signal.geo_preview} colors={colors} /> : null}
                      {triggersLine ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.45 }}>{triggersLine}</p>
                      ) : null}
                      {tier || nConf != null || nConfl != null ? (
                        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
                          {tier ? (
                            <>
                              <span style={{ textTransform: "capitalize", color: colors.text }}>{tier}</span> confluence
                            </>
                          ) : (
                            <span style={{ color: colors.text }}>Confluence</span>
                          )}
                          {nConf != null ? (
                            <>
                              {" "}
                              · {nConf} aligning
                            </>
                          ) : null}
                          {nConfl != null && nConfl > 0 ? (
                            <>
                              {" "}
                              · {nConfl} conflict{nConfl === 1 ? "" : "s"}
                            </>
                          ) : null}
                        </p>
                      ) : null}
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
                              symbolNewsArticles = await fetchSymbolNews(signal.symbol, 10);
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
          </article>
          <EarningsCalendar
            className="order-5 lg:col-start-1 lg:row-start-3"
            events={earningsEvents}
            title="Upcoming Earnings (Next 7 Days)"
            maxDays={7}
          />

          <article
            className={`order-3 flex min-h-[200px] flex-col overflow-hidden lg:col-start-2 lg:row-start-2 lg:self-start ${surfaceGlowClassName}`}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[4]
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: spacing[2],
                flexShrink: 0,
                marginBottom: spacing[2]
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <h3 style={{ margin: 0 }}>Market Intelligence</h3>
                <p style={{ margin: 0, fontSize: 10, color: colors.textMuted, fontStyle: "italic" }}>
                  News filtered to stocks that move markets
                </p>
              </div>
              <InfoTip text={LATEST_HEADLINES_TIP} label="About latest headlines" />
            </div>
            {marketOverview.news.length > 0 ? (
              <div
                className="min-w-0 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{ display: "flex", gap: spacing[1], flexShrink: 0, marginBottom: spacing[2] }}
              >
                {MI_TAB_DEFS.map((t) => {
                  const active = miTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setMiTab(t.id)}
                      style={{
                        flex: "0 0 auto",
                        padding: "5px 10px",
                        borderRadius: 999,
                        border: `1px solid ${active ? colors.accent : colors.border}`,
                        background: active ? `color-mix(in srgb, ${colors.accent} 22%, transparent)` : "transparent",
                        color: active ? colors.text : colors.textMuted,
                        fontSize: 11,
                        fontWeight: active ? 700 : 500,
                        cursor: "pointer",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {marketOverview.news.length === 0 ? (
                marketOverview.error ? (
                  <p style={{ color: colors.textMuted, margin: 0 }}>{marketOverview.error}</p>
                ) : (
                  <p
                    style={{
                      color: colors.textMuted,
                      margin: 0,
                      textAlign: "center",
                      fontSize: typography.scale.sm,
                      lineHeight: 1.55
                    }}
                  >
                    No headlines passed the feed filters: stories must tag tickers, beat a relevance cutoff, and usually sit in
                    a short lookback—quiet markets or a failed upstream fetch can look empty here. The service retries a wider
                    window when the last few hours have nothing.
                  </p>
                )
              ) : filteredMiNews.length === 0 ? (
                <p style={{ color: colors.textMuted, margin: 0, textAlign: "center", fontSize: typography.scale.sm }}>
                  {miEmptyMessage(miTab)}
                </p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: spacing[3] }}>
                  {filteredMiNews.map((article) => (
                    <li
                      key={article.id || article.article_id}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        paddingBottom: spacing[2],
                        display: "grid",
                        gap: spacing[1]
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: spacing[2],
                          flexWrap: "wrap"
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 140px" }}>
                          <p style={{ margin: 0, fontSize: 11, ...sourceLineStyle(article, colors) }}>
                            <span
                              style={{
                                marginRight: 4,
                                color: (CATEGORY_ICONS[articleIntelCategory(article)] ?? CATEGORY_ICONS.general).color
                              }}
                            >
                              {(CATEGORY_ICONS[articleIntelCategory(article)] ?? CATEGORY_ICONS.general).icon}
                            </span>
                            {article.credibility?.band === "elite" || article.credibility?.band === "major" ? (
                              <span style={{ marginRight: 3 }} aria-hidden>
                                ✓
                              </span>
                            ) : null}
                            {(article.publisher?.name || article.source || "Unknown source").trim()} ·{" "}
                            {timeAgo(article.published_utc || article.published_at)}
                          </p>
                          {article.credibility?.label ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignSelf: "flex-start",
                                padding: "2px 8px",
                                borderRadius: 999,
                                fontSize: 9,
                                fontWeight: 700,
                                letterSpacing: 0.3,
                                textTransform: "uppercase",
                                ...credibilityChipStyle(article.credibility.band, colors)
                              }}
                            >
                              {article.credibility.label}
                            </span>
                          ) : null}
                        </div>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color:
                              (article.sentiment || "neutral").toLowerCase() === "positive"
                                ? colors.bullish
                                : (article.sentiment || "neutral").toLowerCase() === "negative"
                                  ? colors.bearish
                                  : colors.caution
                          }}
                        >
                          {((article.sentiment || "neutral").toLowerCase() || "neutral").toUpperCase()}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setHeadlineArticle(article)}
                        style={{
                          display: "block",
                          width: "100%",
                          marginTop: 2,
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          textAlign: "left",
                          cursor: "pointer",
                          color: "#e8f4ff",
                          fontSize: 12,
                          lineHeight: 1.45,
                          fontWeight: 600
                        }}
                      >
                        {article.title.length > 100 ? `${article.title.slice(0, 97)}...` : article.title}
                      </button>
                      {article.affected_stocks && article.affected_stocks.length > 0 ? (
                        <>
                          <p
                            style={{
                              margin: 0,
                              fontSize: 9,
                              letterSpacing: 0.6,
                              textTransform: "uppercase",
                              color: colors.textMuted,
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
                            }}
                          >
                            Affected Stocks
                          </p>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[1] }}>
                            {article.affected_stocks.map((stock) => {
                              const tone = stock.impact;
                              const toneColor = tone === "bullish" ? "#00e87a" : tone === "bearish" ? "#ff3d5a" : "#f5c542";
                              const borderColor =
                                tone === "bullish"
                                  ? "rgba(0,232,122,0.2)"
                                  : tone === "bearish"
                                    ? "rgba(255,61,90,0.2)"
                                    : "rgba(245,197,66,0.2)";
                              const bgColor =
                                tone === "bullish"
                                  ? "rgba(0,232,122,0.04)"
                                  : tone === "bearish"
                                    ? "rgba(255,61,90,0.04)"
                                    : "rgba(245,197,66,0.04)";
                              return (
                                <button
                                  key={`${article.article_id}-${stock.symbol}`}
                                  type="button"
                                  title={stock.is_watchlist ? "On your watchlist" : undefined}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/dashboard/signals?symbol=${encodeURIComponent(stock.symbol)}`);
                                  }}
                                  style={{
                                    border: `1px solid ${stock.is_watchlist ? "rgba(255,255,255,0.25)" : borderColor}`,
                                    background: bgColor,
                                    borderRadius: 999,
                                    color: colors.text,
                                    padding: "4px 8px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    cursor: "pointer"
                                  }}
                                >
                                  <span
                                    style={{
                                      width: 6,
                                      height: 6,
                                      borderRadius: 999,
                                      background: toneColor,
                                      boxShadow: `0 0 8px ${toneColor}`
                                    }}
                                  />
                                  <span style={{ fontSize: 10, fontWeight: 700 }}>
                                    {stock.is_watchlist ? "★ " : ""}
                                    {stock.symbol}
                                  </span>
                                  <span style={{ fontSize: 10, color: toneColor }}>{stock.reason}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      ) : null}
                      {article.impact_summary ? (
                        <p
                          style={{
                            margin: 0,
                            paddingTop: 8,
                            borderTop: "0.5px solid rgba(0,180,255,0.06)",
                            fontSize: 11,
                            fontStyle: "italic",
                            color: "#4a6080",
                            lineHeight: 1.5
                          }}
                        >
                          {article.impact_summary}
                        </p>
                      ) : null}
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <a
                          href={article.article_url || article.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 10, color: colors.textMuted, textDecoration: "none" }}
                        >
                          Open article ↗
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
      </div>

      {morningVisible ? (
        morningBriefSlot ?? (scannerOverview.morningBrief ? (
          <MorningBriefCollapse mb={scannerOverview.morningBrief} pdt={pdt} />
        ) : null)
      ) : null}
      <SignalEvidenceModal open={evidenceOpen} evidence={evidence} onClose={() => setEvidenceOpen(false)} />
      <NewsHeadlineDrawer
        open={headlineArticle != null}
        article={headlineArticle}
        onClose={() => setHeadlineArticle(null)}
      />
    </section>
  );
}
