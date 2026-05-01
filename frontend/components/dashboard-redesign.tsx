"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { DashboardRealtime } from "@/components/dashboard-realtime";
import { InfoTip } from "@/components/info-tip";
import { MiniSparkline } from "@/components/mini-sparkline";
import { SentimentGauge } from "@/components/sentiment-gauge";
import { SignalEvidenceModal } from "@/components/signal-evidence-modal";
import { fetchSymbolNews } from "@/lib/api/fetch-symbol-news";
import type { MarketOverview, NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type { ScannerOverview } from "@/lib/api/scanner";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { buildEvidenceFromSetup, type SignalEvidenceData } from "@/lib/signal-evidence";
import { CONFIDENCE_PERCENT_TIP, MARKET_SENTIMENT_SCORE_TIP, PDT_GUARDIAN_TIP } from "@/lib/ui-tooltips";

interface DashboardRedesignProps {
  marketOverview: MarketOverview;
  pdtStatus: PDTStatusPayload | null;
  scannerOverview: ScannerOverview;
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

function toPercent(change: number): string {
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function toPrice(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "";
  return `$${n.toFixed(2)}`;
}

function computeSnapshotChange(snapshot: SnapshotPayload): { amount: number; percent: number } {
  const last = snapshot.last_trade_price ?? null;
  const prev = snapshot.prev_close ?? null;
  if (typeof last !== "number" || typeof prev !== "number" || prev === 0) {
    return { amount: 0, percent: 0 };
  }
  const amount = last - prev;
  const percent = (amount / prev) * 100;
  return { amount, percent };
}

function marketRegimeLabel(overview: MarketOverview): string {
  const market = (overview.status?.market || "unknown").toLowerCase();
  const avgMove =
    overview.snapshots.length > 0
      ? overview.snapshots
          .map((s) => Math.abs(computeSnapshotChange(s).percent))
          .reduce((sum, v) => sum + v, 0) / overview.snapshots.length
      : 0;
  if (market === "open" && avgMove > 1.5) return "High Volatility";
  if (market === "open") return "Bull Trending";
  if (market === "closed") return "After Hours";
  return "Neutral";
}

function sentimentFromSnapshots(snapshots: SnapshotPayload[]): { score: number; tone: "bullish" | "bearish" | "neutral" } {
  if (snapshots.length === 0) return { score: 50, tone: "neutral" };
  const avgPct = snapshots.map((s) => computeSnapshotChange(s).percent).reduce((a, b) => a + b, 0) / snapshots.length;
  const score = Math.max(0, Math.min(100, Math.round(50 + avgPct * 10)));
  if (avgPct > 0.2) return { score, tone: "bullish" };
  if (avgPct < -0.2) return { score, tone: "bearish" };
  return { score, tone: "neutral" };
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

export function DashboardRedesign({ marketOverview, pdtStatus, scannerOverview }: DashboardRedesignProps) {
  const { colors } = useTheme();
  const [evidence, setEvidence] = useState<SignalEvidenceData | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const sentiment = sentimentFromSnapshots(marketOverview.snapshots);
  const regime = marketRegimeLabel(marketOverview);
  const sentimentColor =
    sentiment.tone === "bullish" ? colors.bullish : sentiment.tone === "bearish" ? colors.bearish : colors.caution;

  const snapshotsBySymbol = new Map(marketOverview.snapshots.map((s) => [s.symbol, s]));
  const statSymbols = ["SPY", "QQQ", "IWM"] as const;
  const morningVisible = isMorningBriefingWindowNow() && !!scannerOverview.briefing;
  const topSignals = scannerOverview.setups.slice(0, 3);
  const pdt = pdtStatus?.assessment;
  const pdtColor = !pdt
    ? colors.textMuted
    : pdt.at_limit
      ? colors.bearish
      : pdt.warn_near_limit
        ? colors.caution
        : colors.bullish;
  const pdtLabel = !pdt ? "Unavailable" : pdt.at_limit ? "Blocked" : pdt.warn_near_limit ? "Warning" : "Clear";
  const vixSnapshot = snapshotsBySymbol.get("VIX") || snapshotsBySymbol.get("^VIX");

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
        <div style={{ display: "grid", gap: spacing[3] }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: spacing[3],
              fontSize: typography.scale.sm
            }}
          >
            {statSymbols.map((symbol) => {
              const snapshot = snapshotsBySymbol.get(symbol);
              const spark = marketOverview.sparklinesBySymbol?.[symbol] ?? [];
              if (!snapshot && !marketOverview.error) {
                return (
                  <article
                    key={symbol}
                    style={{
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.lg,
                      padding: spacing[3],
                      background: colors.surfaceMuted
                    }}
                  >
                    <SkeletonLine width="80%" />
                    <div style={{ marginTop: spacing[2] }}>
                      <SkeletonLine width="100%" height={36} />
                    </div>
                  </article>
                );
              }
              if (!snapshot) {
                return null;
              }
              const { percent } = computeSnapshotChange(snapshot);
              return (
                <article
                  key={symbol}
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.lg,
                    padding: spacing[3],
                    background: colors.surface,
                    display: "grid",
                    gap: spacing[2]
                  }}
                >
                  <div style={{ color: colors.textMuted }}>
                    <strong style={{ color: colors.text }}>{symbol}</strong>{" "}
                    <span style={{ color: colors.text }}>{toPrice(snapshot.last_trade_price)}</span>
                  </div>
                  <div style={{ color: percent >= 0 ? colors.bullish : colors.bearish, fontWeight: 600 }}>{toPercent(percent)}</div>
                  <MiniSparkline closes={spark} upColor={colors.bullish} downColor={colors.bearish} height={36} />
                </article>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: spacing[3], flexWrap: "wrap", alignItems: "center", fontSize: typography.scale.sm }}>
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
          </div>
        </div>
        <DashboardRealtime />
      </article>

      <div className="dashboard-grid" style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: spacing[4] }}>
        <div style={{ display: "grid", gap: spacing[4] }}>
          <article
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[6],
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: spacing[4],
              alignItems: "center"
            }}
          >
            <div>
              <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm, display: "flex", alignItems: "center", gap: 6 }}>
                Market Sentiment Score
                <InfoTip text={MARKET_SENTIMENT_SCORE_TIP} label="About market sentiment score" />
              </p>
              {marketOverview.snapshots.length === 0 && !marketOverview.error ? (
                <div style={{ marginTop: spacing[3], display: "grid", gap: spacing[2] }}>
                  <SkeletonLine width="95px" height={38} />
                  <SkeletonLine width="200px" />
                </div>
              ) : (
                <>
                  <SentimentGauge
                    score={sentiment.score}
                    textColor={colors.text}
                    zoneColors={{
                      red: "#ef4444",
                      amber: "#f59e0b",
                      grey: "#64748b",
                      green: "#22c55e",
                      bright: "#4ade80"
                    }}
                  />
                  <p style={{ margin: `${spacing[2]} 0 0 0`, color: sentimentColor, fontWeight: 600 }}>{regime}</p>
                </>
              )}
            </div>
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm, alignSelf: "center" }}>
              Blend of tape tone from SPY, QQQ, and IWM snapshots. Use as a quick pulse, not trade advice.
            </p>
          </article>

          <section>
            <h3 style={{ marginTop: 0, marginBottom: spacing[2] }}>Top Signals</h3>
            <div style={{ display: "grid", gap: spacing[3] }}>
              {topSignals.length === 0 ? (
                <article style={{ background: colors.surface, borderRadius: borderRadius.lg, padding: spacing[4] }}>
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
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.08 }}
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.lg,
                      padding: spacing[3],
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: spacing[3]
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: spacing[3], minWidth: 0 }}>
                      <p style={{ margin: 0, fontWeight: 700 }}>{signal.symbol}</p>
                      <span
                        style={{
                          background: signal.direction.toLowerCase() === "bullish" ? "rgba(34,197,94,.2)" : "rgba(239,68,68,.2)",
                          color: signal.direction.toLowerCase() === "bullish" ? colors.bullish : colors.bearish,
                          borderRadius: borderRadius.full,
                          padding: "2px 8px",
                          fontSize: typography.scale.xs
                        }}
                      >
                        {signal.direction}
                      </span>
                      <span
                        style={{
                          color: colors.textMuted,
                          fontSize: typography.scale.sm,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4
                        }}
                      >
                        {Math.round(signal.score * 100)}%
                        <InfoTip text={CONFIDENCE_PERCENT_TIP} label="About confidence" />
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const snapshot = snapshotsBySymbol.get(signal.symbol);
                        let symbolNewsArticles: NewsPayload[] = [];
                        try {
                          symbolNewsArticles = await fetchSymbolNews(signal.symbol, 10);
                        } catch {
                          symbolNewsArticles = [];
                        }
                        setEvidence(buildEvidenceFromSetup(signal, snapshot, { symbolNewsArticles }));
                        setEvidenceOpen(true);
                      }}
                      style={{
                        border: `1px solid ${colors.border}`,
                        borderRadius: borderRadius.md,
                        background: "transparent",
                        color: colors.text,
                        padding: `${spacing[1]} ${spacing[2]}`,
                        cursor: "pointer",
                        fontSize: typography.scale.xs,
                        whiteSpace: "nowrap"
                      }}
                    >
                      View Evidence
                    </button>
                  </motion.article>
                ))
              )}
            </div>
          </section>
        </div>

        <aside style={{ display: "grid", gap: spacing[4] }}>
          <article
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[4]
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: spacing[2], flexWrap: "wrap" }}>
              <ShieldCheck color={pdtColor} size={20} />
              <strong style={{ color: pdtColor, fontSize: typography.scale.sm, display: "inline-flex", alignItems: "center", gap: 6 }}>
                PDT Guardian: {pdtLabel}
                <InfoTip text={PDT_GUARDIAN_TIP} label="About pattern day trader rules" />
              </strong>
            </div>
            {!pdt ? (
              <p style={{ margin: `${spacing[2]} 0 0 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
                Connect a broker to enable PDT tracking.
              </p>
            ) : (
              <p style={{ margin: `${spacing[2]} 0 0 0`, color: colors.textMuted, fontSize: typography.scale.sm }}>
                Day trades used {pdt.current_day_trade_count} of {pdt.max_non_exempt} - resets in {pdt.days_until_reset} day
                {pdt.days_until_reset === 1 ? "" : "s"}.
              </p>
            )}
          </article>

          <article
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[4],
              maxHeight: 390,
              overflow: "auto"
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: spacing[2] }}>Latest Headlines</h3>
            {marketOverview.news.length === 0 ? (
              marketOverview.error ? (
                <p style={{ color: colors.textMuted, margin: 0 }}>Unable to connect. Check your connection.</p>
              ) : (
                <p style={{ color: colors.textMuted, margin: 0 }}>No recent market news.</p>
              )
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: spacing[3] }}>
                {marketOverview.news.slice(0, 5).map((article) => (
                  <li key={article.article_id} style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: spacing[3] }}>
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
                      {article.source || "Unknown source"} - {timeAgo(article.published_at)}
                    </p>
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-block",
                        marginTop: spacing[1],
                        color: colors.text,
                        fontSize: typography.scale.sm,
                        lineHeight: 1.35
                      }}
                    >
                      {article.title.length > 110 ? `${article.title.slice(0, 107)}...` : article.title}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </aside>
      </div>

      {morningVisible ? (
        <article
          style={{
            border: `1px solid ${colors.accent}`,
            borderRadius: borderRadius.lg,
            background: "rgba(59,130,246,0.12)",
            padding: spacing[4]
          }}
        >
          <button
            type="button"
            onClick={() => setBriefOpen((v) => !v)}
            style={{
              cursor: "pointer",
              fontWeight: 700,
              border: "none",
              background: "transparent",
              color: colors.text,
              padding: 0
            }}
          >
            Morning Briefing: {scannerOverview.gaps.length} gaps, {scannerOverview.catalysts.length} catalysts, top setup{" "}
            {topSignals[0]?.symbol || "pending"}
          </button>
          {briefOpen ? (
            <pre style={{ whiteSpace: "pre-wrap", margin: `${spacing[3]} 0 0 0`, fontFamily: typography.fontFamilySans }}>
              {scannerOverview.briefing?.markdown || "Briefing unavailable."}
            </pre>
          ) : null}
        </article>
      ) : null}
      <SignalEvidenceModal open={evidenceOpen} evidence={evidence} onClose={() => setEvidenceOpen(false)} />
    </section>
  );
}
