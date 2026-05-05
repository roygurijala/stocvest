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
import type { MarketOverview, NewsCredibilityBand, NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type { ScannerOverview } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
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

type MiTab = "all" | "watchlist" | "earnings" | "analyst" | "macro" | "ma" | "other";

const MI_TAB_DEFS: { id: MiTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "watchlist", label: "Watchlist" },
  { id: "earnings", label: "Earnings" },
  { id: "analyst", label: "Analyst" },
  { id: "macro", label: "Macro" },
  { id: "ma", label: "M&A" },
  { id: "other", label: "Other" }
];

function articleMatchesMiTab(article: NewsPayload, tab: MiTab): boolean {
  const cat = article.catalyst_category ?? "general";
  if (tab === "all") return true;
  if (tab === "watchlist") {
    return Boolean(article.matches_watchlist || article.affected_stocks?.some((s) => s.is_watchlist));
  }
  if (tab === "other") {
    return cat === "general" || cat === "fda" || cat === "sector";
  }
  if (tab === "ma") return cat === "ma";
  return cat === tab;
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

      <div className="dashboard-grid grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr] [&>*]:min-w-0">
          <div className="order-1 min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <MarketSentimentScoreWidget marketOverview={marketOverview} />
            <p style={{ margin: `${spacing[2]} 0 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
              Blend of tape tone from SPY, QQQ, and IWM snapshots. Use as a quick pulse, not trade advice.
            </p>
          </div>

          <section className="order-2 lg:col-start-1 lg:row-start-2">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: spacing[2],
                marginBottom: spacing[2]
              }}
            >
              <h3 style={{ margin: 0 }}>Top Signals</h3>
              <InfoTip text={TOP_SIGNALS_TIP} label="About top signals" />
            </div>
            <div style={{ display: "grid", gap: spacing[3] }}>
              {topSignals.length === 0 ? (
                <article
                  className={surfaceGlowClassName}
                  style={{ background: colors.surface, borderRadius: borderRadius.lg, padding: spacing[4] }}
                >
                  {scannerOverview.error ? (
                    <p style={{ margin: 0, color: colors.textMuted }}>Unable to connect. Check your connection.</p>
                  ) : (
                    <p style={{ margin: 0, color: colors.textMuted }}>
                      Intelligence engine is warming up. Check back at market open.
                    </p>
                  )}
                </article>
              ) : (
                topSignals.map((signal, idx) => (
                  <motion.article
                    key={`${signal.symbol}-${idx}`}
                    className={surfaceGlowClassName}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.08 }}
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.lg,
                      padding: spacing[3],
                      display: "grid",
                      gap: spacing[2],
                      position: "relative",
                      paddingBottom: spacing[5]
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: spacing[2] }}>
                      <div style={{ display: "flex", alignItems: "center", gap: spacing[2], minWidth: 0, flexWrap: "wrap" }}>
                        <p style={{ margin: 0, fontWeight: 700 }}>{signal.symbol}</p>
                        <span
                          style={{
                            background: ["bullish", "long"].includes(signal.direction.toLowerCase())
                              ? "rgba(34,197,94,.2)"
                              : "rgba(239,68,68,.2)",
                            color: ["bullish", "long"].includes(signal.direction.toLowerCase()) ? colors.bullish : colors.bearish,
                            borderRadius: borderRadius.full,
                            padding: "2px 8px",
                            fontSize: typography.scale.xs
                          }}
                        >
                          {signal.direction}
                        </span>
                      </div>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>{Math.round(signal.score * 100)}%</span>
                        <InfoTip text={CONFIDENCE_PERCENT_TIP} label="About signal strength" />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="min-h-11 text-sm"
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
                            ? Math.floor((Date.parse(`${event.report_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
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
                        border: `1px solid ${colors.border}`,
                        borderRadius: borderRadius.md,
                        background: "transparent",
                        color: colors.text,
                        padding: `${spacing[2]} ${spacing[3]}`,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        justifySelf: "start"
                      }}
                    >
                      View Evidence
                    </button>
                    <div style={{ position: "absolute", right: spacing[3], bottom: spacing[3] }}>
                      <SignalDisclaimerChip />
                    </div>
                  </motion.article>
                ))
              )}
            </div>
          </section>
          <EarningsCalendar
            className="order-5 lg:col-start-1 lg:row-start-3"
            events={earningsEvents}
            title="Upcoming Earnings (Next 7 Days)"
            maxDays={7}
          />

          <article
            className={`order-3 flex min-h-0 flex-col lg:col-start-2 lg:row-start-2 ${surfaceGlowClassName}`}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[4],
              height: 460,
              maxHeight: 460
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
                  <p style={{ color: colors.textMuted, margin: 0 }}>Unable to connect. Check your connection.</p>
                ) : (
                  <p style={{ color: colors.textMuted, margin: 0, textAlign: "center", fontSize: typography.scale.sm }}>
                    No major market-moving headlines in the last 4 hours.
                  </p>
                )
              ) : filteredMiNews.length === 0 ? (
                <p style={{ color: colors.textMuted, margin: 0, textAlign: "center", fontSize: typography.scale.sm }}>
                  No headlines in this category right now. Try another tab.
                </p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: spacing[3] }}>
                  {filteredMiNews.map((article) => (
                    <li
                      key={article.id || article.article_id}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        paddingBottom: spacing[3],
                        display: "grid",
                        gap: spacing[2]
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
                          <p style={{ margin: 0, color: article.publisher?.tier === 1 ? "#00d4ff" : "#4a6080", fontSize: 11 }}>
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
                          marginTop: spacing[1],
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          textAlign: "left",
                          cursor: "pointer",
                          color: "#e8f4ff",
                          fontSize: 13,
                          lineHeight: 1.5,
                          fontWeight: 600
                        }}
                      >
                        {article.title.length > 110 ? `${article.title.slice(0, 107)}...` : article.title}
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
