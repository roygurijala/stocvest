"use client";

import type { EarningsEvent } from "@/lib/api/earnings";
import type { NewsPayload, SnapshotPayload } from "@/lib/api/market";
import type { SwingCompositeMarketStatus } from "@/lib/api/swing-composite";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { SignalDisclaimerChip } from "@/components/signal-disclaimer-chip";

type SignalsAfterHoursPanelProps = {
  symbol: string;
  snapshot: SnapshotPayload | null;
  marketStatus: SwingCompositeMarketStatus | null;
  earningsEvent: EarningsEvent | null;
  newsArticles: NewsPayload[];
  isInDefaultWatchlist: boolean;
  watchlistCheckComplete: boolean;
};

function sentimentDot(sentiment: string | null | undefined, score: number | null | undefined): string {
  const lower = (sentiment ?? "").toLowerCase();
  if (lower === "positive") return "#22c55e";
  if (lower === "negative") return "#ef4444";
  if (typeof score === "number") {
    if (score > 0.1) return "#22c55e";
    if (score < -0.1) return "#ef4444";
  }
  return "#f5c542";
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

function earningsWithinDays(event: EarningsEvent | null, days: number): boolean {
  if (!event?.report_date) return false;
  const diff = Date.parse(`${event.report_date}T00:00:00Z`) - Date.now();
  return diff >= 0 && diff <= days * 86400000;
}

function earningsTimingLabel(reportTime: EarningsEvent["report_time"]): "BMO" | "AMC" | "DURING" | "TBD" {
  if (reportTime === "before_market") return "BMO";
  if (reportTime === "after_market") return "AMC";
  if (reportTime === "during_market") return "DURING";
  return "TBD";
}

export function SignalsAfterHoursPanel({
  symbol,
  snapshot,
  marketStatus,
  earningsEvent,
  newsArticles,
  isInDefaultWatchlist,
  watchlistCheckComplete
}: SignalsAfterHoursPanelProps) {
  const { colors } = useTheme();
  const sym = symbol.trim().toUpperCase() || "—";
  const last = snapshot?.last_trade_price ?? null;
  const prevClose = snapshot?.prev_close ?? null;
  const dayChange = typeof last === "number" && typeof prevClose === "number" ? last - prevClose : null;
  const dayChangePct =
    typeof dayChange === "number" && typeof prevClose === "number" && prevClose > 0 ? (dayChange / prevClose) * 100 : null;
  const watchAbove = snapshot?.day_high ?? null;
  const watchBelow = snapshot?.day_low ?? null;
  const orbLow = snapshot?.day_low ?? null;
  const orbHigh = snapshot?.day_high ?? null;

  return (
    <article
      className={surfaceGlowClassName}
      style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
    >
      <div style={{ display: "grid", gap: spacing[2] }}>
        <h3 style={{ margin: 0 }}>After-Hours Research Panel</h3>
        <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>
          Market closed{marketStatus?.next_open ? ` · next session: ${marketStatus.next_open}` : ""}. Signal available at 9:30 AM ET.
        </p>
      </div>

      <section style={{ marginTop: spacing[4], display: "grid", gap: spacing[2] }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spacing[2], flexWrap: "wrap" }}>
          <h4 style={{ margin: 0 }}>{sym}</h4>
          <AddToWatchlistButton symbol={sym} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[3], color: colors.textMuted, fontSize: typography.scale.sm }}>
          <span>Last: {formatUsd(last)}</span>
          <span style={{ color: (dayChange ?? 0) >= 0 ? colors.bullish : colors.bearish }}>
            Change: {typeof dayChange === "number" ? `${dayChange >= 0 ? "+" : ""}${dayChange.toFixed(2)}` : "n/a"} (
            {typeof dayChangePct === "number" ? `${dayChangePct >= 0 ? "+" : ""}${dayChangePct.toFixed(2)}%` : "n/a"})
          </span>
        </div>
      </section>

      <section style={{ marginTop: spacing[4], display: "grid", gap: spacing[2] }}>
        <h4 style={{ margin: 0 }}>Last Session Reference Levels</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <p style={{ margin: 0 }}>Last close: <strong>{formatUsd(snapshot?.prev_close)}</strong></p>
          <p style={{ margin: 0 }}>Day high: <strong>{formatUsd(snapshot?.day_high)}</strong></p>
          <p style={{ margin: 0 }}>Day low: <strong>{formatUsd(snapshot?.day_low)}</strong></p>
          <p style={{ margin: 0 }}>VWAP: <strong>{formatUsd(snapshot?.day_vwap)}</strong></p>
        </div>
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>Label: Last Session (not predictions)</p>
      </section>

      <section style={{ marginTop: spacing[4], display: "grid", gap: spacing[2] }}>
        <h4 style={{ margin: 0 }}>Earnings Alert</h4>
        {earningsWithinDays(earningsEvent, 7) ? (
          <p style={{ margin: 0, color: colors.textMuted }}>
            {earningsEvent?.report_date} · {earningsTimingLabel(earningsEvent?.report_time ?? "unknown")} · Est EPS{" "}
            {typeof earningsEvent?.estimated_eps === "number" ? earningsEvent.estimated_eps.toFixed(2) : "n/a"} · Implied move n/a
          </p>
        ) : (
          <p style={{ margin: 0, color: colors.textMuted }}>No earnings event within the next 7 days.</p>
        )}
      </section>

      <section style={{ marginTop: spacing[4], display: "grid", gap: spacing[2] }}>
        <h4 style={{ margin: 0 }}>Recent News</h4>
        {newsArticles.length === 0 ? (
          <p style={{ margin: 0, color: colors.textMuted }}>No recent headlines available right now.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: spacing[2] }}>
            {newsArticles.slice(0, 5).map((article) => (
              <li key={article.article_id} style={{ borderTop: `1px solid ${colors.border}`, paddingTop: spacing[2] }}>
                <a href={article.article_url || article.url} target="_blank" rel="noreferrer" style={{ color: colors.text }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: borderRadius.full,
                      background: sentimentDot(article.sentiment, article.sentiment_score),
                      marginRight: 8
                    }}
                  />
                  {article.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: spacing[4], display: "grid", gap: spacing[1] }}>
        <h4 style={{ margin: 0 }}>Tomorrow's Watch Levels</h4>
        <p style={{ margin: 0, color: colors.textMuted }}>Watch for breakout above: {formatUsd(watchAbove)}</p>
        <p style={{ margin: 0, color: colors.textMuted }}>Watch for breakdown below: {formatUsd(watchBelow)}</p>
        <p style={{ margin: 0, color: colors.textMuted }}>
          ORB reference zone: {formatUsd(orbLow)} - {formatUsd(orbHigh)}
        </p>
        <p style={{ margin: 0, color: colors.textMuted }}>Signal available at: 9:30 AM ET</p>
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>
          Reference levels from last session data. Not predictions. Not investment advice.
        </p>
      </section>

      {watchlistCheckComplete && !isInDefaultWatchlist ? (
        <section style={{ marginTop: spacing[4], display: "grid", gap: spacing[2] }}>
          <p style={{ margin: 0, color: colors.textMuted }}>Get notified when {sym} signal fires.</p>
          <AddToWatchlistButton symbol={sym} />
        </section>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: spacing[3] }}>
        <SignalDisclaimerChip />
      </div>
    </article>
  );
}
