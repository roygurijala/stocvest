"use client";

import { useState } from "react";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { fetchPortfolioReviewClient } from "@/lib/api/fetch-portfolio-review-client";
import type {
  HoldingReview,
  PortfolioReview,
  ReviewAction
} from "@/lib/portfolio/review-types";

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

/**
 * Map a review action to a theme color (so badges track dark/light and the app's
 * P/L color language). Unknown/missing actions fall back to the muted color instead
 * of rendering an undefined background.
 */
function actionColor(
  action: ReviewAction | string | null | undefined,
  colors: { bullish: string; bearish: string; caution: string; textMuted: string }
): string {
  switch (action) {
    case "buy_more":
      return colors.bullish;
    case "sell":
      return colors.bearish;
    case "trim":
      return colors.caution;
    case "hold":
    case "review":
    default:
      return colors.textMuted;
  }
}

export function PortfolioReviewPanel() {
  const { colors } = useTheme();
  const [review, setReview] = useState<PortfolioReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runReview() {
    setLoading(true);
    setError(null);
    const result = await fetchPortfolioReviewClient();
    if (!result) {
      setError("Could not run the review right now. Please try again.");
    } else {
      setReview(result);
    }
    setLoading(false);
  }

  const card: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: borderRadius.lg,
    padding: spacing[4]
  };
  const btnPrimary: React.CSSProperties = {
    background: colors.accent,
    color: "#fff",
    border: `1px solid ${colors.accent}`,
    borderRadius: borderRadius.md,
    padding: `${spacing[2]} ${spacing[3]}`,
    fontSize: typography.scale.sm,
    cursor: "pointer"
  };
  const muted: React.CSSProperties = { fontSize: typography.scale.xs, color: colors.textMuted };

  return (
    <div style={card} data-testid="portfolio-review-panel">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: spacing[3]
        }}
      >
        <div>
          <div style={{ fontSize: typography.scale.sm, color: colors.text, fontWeight: 600 }}>
            Daily review
          </div>
          <div style={muted}>
            STOCVEST reads each holding (Long-Term desk) and tells you to hold, add, trim, or sell.
          </div>
        </div>
        <button
          data-testid="run-review"
          type="button"
          style={btnPrimary}
          disabled={loading}
          onClick={() => void runReview()}
        >
          {loading ? "Reviewing…" : review ? "Re-run review" : "Run review"}
        </button>
      </div>

      {error ? (
        <div style={{ color: colors.bearish, fontSize: typography.scale.sm }}>{error}</div>
      ) : null}

      {!review && !loading && !error ? (
        <div style={muted}>Run the review to get today&apos;s per-holding guidance.</div>
      ) : null}

      {review ? (
        <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
          {/* Portfolio return vs benchmark */}
          {review.benchmark ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: spacing[4],
                fontSize: typography.scale.sm,
                color: colors.text
              }}
            >
              <span>
                Your return:{" "}
                <strong
                  style={{
                    color:
                      (review.portfolioReturnPct ?? 0) >= 0 ? colors.bullish : colors.bearish
                  }}
                >
                  {fmtPct(review.portfolioReturnPct)}
                </strong>
              </span>
              <span>
                {review.benchmark.benchmarkSymbol} (money-weighted):{" "}
                <strong>{fmtPct(review.benchmark.benchmarkReturnPct)}</strong>
              </span>
            </div>
          ) : null}

          {!review.fullyPriced ? (
            <div style={muted}>
              Some live prices were unavailable — affected values show &ldquo;—&rdquo;.
            </div>
          ) : null}

          {/* Per-holding actions */}
          {review.holdings.length === 0 ? (
            <div style={muted}>
              No holdings to review yet. Add positions above and STOCVEST will read each one.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
              {review.holdings.map((h) => (
                <ReviewRow key={h.symbol} h={h} />
              ))}
            </div>
          )}

          {/* Concentration */}
          {review.concentration.length > 0 ? (
            <div>
              <div style={{ fontSize: typography.scale.sm, color: colors.text, fontWeight: 600 }}>
                Concentration
              </div>
              <ul style={{ margin: `${spacing[1]} 0 0`, paddingLeft: spacing[4] }}>
                {review.concentration.map((c) => (
                  <li key={c.symbol} style={{ fontSize: typography.scale.sm, color: colors.text }}>
                    {c.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Consider adding */}
          {review.considerAdding.length > 0 ? (
            <div>
              <div style={{ fontSize: typography.scale.sm, color: colors.text, fontWeight: 600 }}>
                Consider adding
              </div>
              <ul style={{ margin: `${spacing[1]} 0 0`, paddingLeft: spacing[4] }}>
                {review.considerAdding.map((c) => (
                  <li key={c.symbol} style={{ fontSize: typography.scale.sm, color: colors.text }}>
                    <strong>{c.symbol}</strong> ({c.tier}) — {c.why}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div style={muted}>{review.disclaimer}</div>
        </div>
      ) : null}
    </div>
  );
}

function ReviewRow({ h }: { h: HoldingReview }) {
  const { colors } = useTheme();
  const badge: React.CSSProperties = {
    background: actionColor(h.action, colors),
    color: "#fff",
    borderRadius: borderRadius.sm,
    padding: `2px ${spacing[2]}`,
    fontSize: typography.scale.xs,
    fontWeight: 700,
    whiteSpace: "nowrap"
  };
  return (
    <div
      data-testid={`review-row-${h.symbol}`}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        padding: spacing[3],
        display: "flex",
        flexDirection: "column",
        gap: spacing[1]
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
        <span style={{ fontSize: typography.scale.sm, color: colors.text, fontWeight: 700 }}>
          {h.symbol}
        </span>
        <span style={badge}>{h.actionLabel}</span>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
          {fmtPct(h.unrealizedPlPct)} · {h.weightPct != null ? `${h.weightPct.toFixed(1)}%` : "—"} wt
        </span>
        {h.suggestedAddAmount ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.bullish }}>
            add ~{fmtUsd(h.suggestedAddAmount)}
          </span>
        ) : null}
        {h.suggestedReduceAmount ? (
          <span style={{ fontSize: typography.scale.xs, color: colors.bearish }}>
            reduce ~{fmtUsd(h.suggestedReduceAmount)}
          </span>
        ) : null}
      </div>
      {h.rationale.length > 0 ? (
        <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
          {h.rationale.join(" ")}
        </div>
      ) : null}
      {h.taxLotHint ? (
        <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{h.taxLotHint}</div>
      ) : null}
      {h.holderRead?.headline || (h.holderRead?.actions?.length ?? 0) > 0 ? (
        <div
          data-testid={`holder-read-${h.symbol}`}
          style={{
            fontSize: typography.scale.xs,
            color: colors.text,
            marginTop: spacing[1],
            display: "flex",
            flexDirection: "column",
            gap: 2
          }}
        >
          {h.holderRead?.headline ? <strong>{h.holderRead.headline}</strong> : null}
          {(h.holderRead?.actions?.length ?? 0) > 0 ? (
            <ul style={{ margin: 0, paddingLeft: spacing[4] }}>
              {h.holderRead!.actions!.map((a, i) => (
                <li key={i} style={{ color: colors.textMuted }}>
                  {a}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {h.aiRead ? (
        <div style={{ fontSize: typography.scale.sm, color: colors.text, marginTop: spacing[1] }}>
          {h.aiRead}
        </div>
      ) : null}
    </div>
  );
}
