"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import type { MarketOverview, SnapshotPayload } from "@/lib/api/market";
import type { PDTStatusPayload } from "@/lib/api/pdt";
import type { ScannerOverview } from "@/lib/api/scanner";
import { borderRadius, colorTokens, shadows, spacing, typography } from "@/lib/design-system";

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
  if (typeof n !== "number" || Number.isNaN(n)) return "n/a";
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
  const colors = colorTokens.dark;
  const sentiment = sentimentFromSnapshots(marketOverview.snapshots);
  const regime = marketRegimeLabel(marketOverview);
  const sentimentColor =
    sentiment.tone === "bullish" ? colors.bullish : sentiment.tone === "bearish" ? colors.bearish : colors.caution;

  const snapshotsBySymbol = new Map(marketOverview.snapshots.map((s) => [s.symbol, s]));
  const statSymbols = ["SPY", "QQQ", "IWM"] as const;
  const morningVisible = isMorningBriefingWindowNow() && !!scannerOverview.briefing;
  const topSignals = scannerOverview.setups.slice(0, 3);
  const pdt = pdtStatus?.assessment;
  const pdtColor = !pdt ? colors.textMuted : pdt.at_limit ? colors.bearish : pdt.warn_near_limit ? colors.caution : colors.bullish;
  const pdtLabel = !pdt ? "Unavailable" : pdt.at_limit ? "Blocked" : pdt.warn_near_limit ? "Warning" : "OK";

  return (
    <section style={{ display: "grid", gap: spacing[4] }}>
      {morningVisible ? (
        <details
          style={{
            border: `1px solid ${colors.accent}`,
            borderRadius: borderRadius.lg,
            background: "rgba(59,130,246,0.12)",
            padding: spacing[4]
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            Morning Briefing: {scannerOverview.gaps.length} gaps, {scannerOverview.catalysts.length} catalysts, top setup{" "}
            {topSignals[0]?.symbol || "n/a"}
          </summary>
          <pre style={{ whiteSpace: "pre-wrap", margin: `${spacing[3]} 0 0 0`, fontFamily: typography.fontFamilySans }}>
            {scannerOverview.briefing?.markdown || "Briefing unavailable."}
          </pre>
        </details>
      ) : null}

      <div className="dashboard-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: spacing[4] }}>
        <div style={{ display: "grid", gap: spacing[4] }}>
          <article
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.xl,
              padding: spacing[6]
            }}
          >
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>Market Sentiment</p>
            {marketOverview.snapshots.length === 0 && !marketOverview.error ? (
              <div style={{ marginTop: spacing[3], display: "grid", gap: spacing[2] }}>
                <SkeletonLine width="90px" height={38} />
                <SkeletonLine width="180px" />
              </div>
            ) : (
              <>
                <div style={{ fontSize: typography.scale["4xl"], fontWeight: 800, color: sentimentColor, marginTop: spacing[2] }}>
                  {sentiment.score}
                </div>
                <p style={{ margin: `${spacing[2]} 0 0 0`, color: colors.textMuted }}>{regime}</p>
              </>
            )}
          </article>

          <div className="stat-cards-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: spacing[3] }}>
            {statSymbols.map((symbol) => {
              const snapshot = snapshotsBySymbol.get(symbol);
              const { amount, percent } = snapshot ? computeSnapshotChange(snapshot) : { amount: 0, percent: 0 };
              const up = percent >= 0;
              return (
                <motion.article
                  key={symbol}
                  whileHover={{ y: -2 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.lg,
                    padding: spacing[4],
                    boxShadow: shadows.sm
                  }}
                >
                  <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>{symbol}</p>
                  {!snapshot && !marketOverview.error ? (
                    <div style={{ display: "grid", gap: spacing[2], marginTop: spacing[2] }}>
                      <SkeletonLine width="85px" />
                      <SkeletonLine width="120px" />
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: `${spacing[1]} 0`, fontWeight: 700 }}>{toPrice(snapshot?.last_trade_price)}</p>
                      <p style={{ margin: 0, color: up ? colors.bullish : colors.bearish, fontSize: typography.scale.sm }}>
                        {up ? <TrendingUp size={14} style={{ verticalAlign: "text-top" }} /> : <TrendingDown size={14} style={{ verticalAlign: "text-top" }} />}{" "}
                        {amount >= 0 ? "+" : ""}
                        {amount.toFixed(2)} ({toPercent(percent)})
                      </p>
                    </>
                  )}
                </motion.article>
              );
            })}
          </div>

          <article
            style={{
              display: "flex",
              alignItems: "center",
              gap: spacing[3],
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.lg,
              padding: spacing[3]
            }}
          >
            <ShieldCheck color={pdtColor} size={20} />
            <div style={{ display: "grid", gap: 2 }}>
              <strong style={{ color: pdtColor, fontSize: typography.scale.sm }}>PDT Guardian: {pdtLabel}</strong>
              <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
                Day trades used {pdt?.current_day_trade_count ?? "n/a"} of {pdt?.max_non_exempt ?? 3}; reset in {pdt?.days_until_reset ?? "n/a"} days
              </span>
            </div>
          </article>

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: spacing[2] }}>
              <h3 style={{ margin: 0 }}>Top Signals</h3>
              <Link href="/signals" style={{ color: colors.accent, fontSize: typography.scale.sm }}>
                View All Signals
              </Link>
            </div>
            <div className="top-signals-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: spacing[3] }}>
              {topSignals.length === 0 ? (
                <article style={{ gridColumn: "1 / -1", background: colors.surface, borderRadius: borderRadius.lg, padding: spacing[4] }}>
                  {scannerOverview.error ? (
                    <p style={{ margin: 0, color: colors.textMuted }}>Signals unavailable right now.</p>
                  ) : (
                    <div style={{ display: "grid", gap: spacing[2] }}>
                      <SkeletonLine width="45%" />
                      <SkeletonLine width="62%" />
                    </div>
                  )}
                </article>
              ) : (
                topSignals.map((signal, idx) => (
                  <motion.article
                    key={`${signal.symbol}-${idx}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.08 }}
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: borderRadius.lg,
                      padding: spacing[4]
                    }}
                  >
                    <p style={{ margin: 0, fontWeight: 700 }}>{signal.symbol}</p>
                    <p style={{ margin: `${spacing[2]} 0`, fontSize: typography.scale.sm }}>
                      <span
                        style={{
                          background: signal.direction.toLowerCase() === "bullish" ? "rgba(34,197,94,.2)" : "rgba(239,68,68,.2)",
                          color: signal.direction.toLowerCase() === "bullish" ? colors.bullish : colors.bearish,
                          borderRadius: borderRadius.full,
                          padding: "2px 8px"
                        }}
                      >
                        {signal.direction}
                      </span>
                    </p>
                    <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>
                      Confidence {Math.round(signal.score * 100)}%
                    </p>
                  </motion.article>
                ))
              )}
            </div>
          </section>
        </div>

        <aside
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.xl,
            padding: spacing[4],
            maxHeight: 620,
            overflow: "auto"
          }}
        >
          <h3 style={{ marginTop: 0 }}>Latest Headlines</h3>
          {marketOverview.news.length === 0 ? (
            marketOverview.error ? (
              <p style={{ color: colors.textMuted }}>Headlines unavailable.</p>
            ) : (
              <div style={{ display: "grid", gap: spacing[3] }}>
                <SkeletonLine width="85%" />
                <SkeletonLine width="95%" />
                <SkeletonLine width="75%" />
              </div>
            )
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: spacing[3] }}>
              {marketOverview.news.slice(0, 5).map((article) => (
                <li key={article.article_id} style={{ borderBottom: `1px solid ${colors.border}`, paddingBottom: spacing[3] }}>
                  <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
                    {article.source || "Unknown source"} · {timeAgo(article.published_at)}
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
        </aside>
      </div>
    </section>
  );
}
