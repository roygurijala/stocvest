"use client";

import { useState } from "react";
import Link from "next/link";

import { borderRadius, spacing, typography } from "@/lib/design-system";
import { portfolioHoldingDeepDiveHref } from "@/lib/portfolio/holdings-present";
import { useIsMobileLayout } from "@/lib/hooks/use-is-mobile-layout";
import { useTheme } from "@/lib/theme-provider";
import { fetchPortfolioReviewClient } from "@/lib/api/fetch-portfolio-review-client";
import type {
  HoldingReview,
  PortfolioReview,
  ReviewAction
} from "@/lib/portfolio/review-types";
import { PORTFOLIO_REVIEW_SIZING_RULE } from "@/lib/portfolio/review-types";

const WHY_LINE_MAX = 120;

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

/** Collapsed Why cell: sizingReason, else first rationale line, truncated. */
export function holdingWhyLine(h: HoldingReview, maxChars = WHY_LINE_MAX): string {
  const raw = (h.sizingReason?.trim() || h.rationale.find((s) => s.trim()) || "").trim();
  if (!raw) return h.actionLabel || "—";
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/** Collapsed Do-this cell. Prefer add, else reduce, else an em dash. */
export function holdingDoThis(h: HoldingReview): string {
  if (h.suggestedAddAmount) return `add ~${fmtUsd(h.suggestedAddAmount)}`;
  if (h.suggestedReduceAmount) return `reduce ~${fmtUsd(h.suggestedReduceAmount)}`;
  return "—";
}

function remainingRationale(h: HoldingReview): string[] {
  if (h.sizingReason?.trim()) return h.rationale;
  const firstIdx = h.rationale.findIndex((s) => s.trim());
  if (firstIdx < 0) return [];
  return h.rationale.filter((_, i) => i !== firstIdx);
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

export function PortfolioReviewPanel({ onReviewComplete }: { onReviewComplete?: () => void } = {}) {
  const { colors } = useTheme();
  const isMobile = useIsMobileLayout();
  const [review, setReview] = useState<PortfolioReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runReview() {
    setLoading(true);
    setError(null);
    const result = await fetchPortfolioReviewClient();
    if (!result.ok) {
      setError(result.message);
    } else {
      setReview(result.review);
      onReviewComplete?.();
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

      {loading && !review ? (
        <div style={muted}>
          Reading each holding on the Long-Term desk. A full book can take about a minute —
          this page will update when it&apos;s ready.
        </div>
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

          {review.targetIsDefault && review.sizingPolicy === "sleeve" ? (
            <div data-testid="review-default-target" style={muted}>
              Using conviction sleeves (core 10–15% · standard 6–9% · vehicle 4–6% ·
              exit 0–3%; max 15%). An explicit target in Portfolio settings still wins.
            </div>
          ) : review.targetIsDefault && review.effectiveTargetPct != null ? (
            <div data-testid="review-default-target" style={muted}>
              Using default ~{review.effectiveTargetPct.toFixed(1)}% target —
              changeable in Portfolio settings.
            </div>
          ) : null}

          <div data-testid="review-sizing-rule" style={muted}>
            {review.sizingRule || PORTFOLIO_REVIEW_SIZING_RULE}
          </div>

          {!review.fullyPriced ? (
            <div style={muted}>
              Some live prices were unavailable — affected values show &ldquo;—&rdquo;.
            </div>
          ) : null}

          {review.holdings.length === 0 ? (
            <div style={muted}>
              No holdings to review yet. Add positions above and STOCVEST will read each one.
            </div>
          ) : isMobile ? (
            <div
              data-testid="review-holdings-table"
              style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}
            >
              {review.holdings.map((h) => (
                <ReviewCard key={h.symbol} h={h} />
              ))}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                data-testid="review-holdings-table"
                style={{ width: "100%", borderCollapse: "collapse" }}
              >
                <thead>
                  <tr>
                    <th style={thStyle(colors, "left")}>Symbol</th>
                    <th style={thStyle(colors, "left")}>Action</th>
                    <th style={thStyle(colors, "right")}>P/L vs cost</th>
                    <th style={thStyle(colors, "right")}>Weight %</th>
                    <th style={thStyle(colors, "right")}>Do this</th>
                    <th style={thStyle(colors, "left")}>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {review.holdings.map((h) => (
                    <ReviewTableRow key={h.symbol} h={h} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

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

function thStyle(
  colors: { textMuted: string },
  align: "left" | "right"
): React.CSSProperties {
  return {
    textAlign: align,
    padding: `${spacing[2]} ${spacing[3]}`,
    fontSize: typography.scale.xs,
    color: colors.textMuted,
    fontWeight: 600,
    whiteSpace: "nowrap"
  };
}

function tdStyle(
  colors: { text: string; border: string },
  align: "left" | "right",
  extra?: React.CSSProperties
): React.CSSProperties {
  return {
    textAlign: align,
    padding: `${spacing[2]} ${spacing[3]}`,
    fontSize: typography.scale.sm,
    color: colors.text,
    borderTop: `1px solid ${colors.border}`,
    verticalAlign: "top",
    ...extra
  };
}

function ActionBadge({ h }: { h: HoldingReview }) {
  const { colors } = useTheme();
  return (
    <span
      style={{
        background: actionColor(h.action, colors),
        color: "#fff",
        borderRadius: borderRadius.sm,
        padding: `2px ${spacing[2]}`,
        fontSize: typography.scale.xs,
        fontWeight: 700,
        whiteSpace: "nowrap"
      }}
    >
      {h.actionLabel}
    </span>
  );
}

function DoThisCell({ h }: { h: HoldingReview }) {
  const { colors } = useTheme();
  const label = holdingDoThis(h);
  const color =
    h.suggestedAddAmount
      ? colors.bullish
      : h.suggestedReduceAmount
        ? colors.bearish
        : colors.textMuted;
  return (
    <span data-testid={`review-do-this-${h.symbol}`} style={{ color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function WhyToggle({
  h,
  open,
  onToggle
}: {
  h: HoldingReview;
  open: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  const why = holdingWhyLine(h);
  return (
    <button
      type="button"
      data-testid={`review-why-toggle-${h.symbol}`}
      aria-expanded={open}
      aria-label={open ? `Hide detail for ${h.symbol}` : `Show why for ${h.symbol}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      style={{
        display: "inline-flex",
        alignItems: "flex-start",
        gap: spacing[1],
        background: "none",
        border: "none",
        padding: 0,
        margin: 0,
        cursor: "pointer",
        textAlign: "left",
        fontSize: typography.scale.xs,
        color: colors.textMuted,
        maxWidth: "100%"
      }}
    >
      <span
        data-testid={h.sizingReason ? `sizing-reason-${h.symbol}` : undefined}
        style={{ flex: 1 }}
      >
        {why}
      </span>
      <span aria-hidden="true" style={{ color: colors.textMuted, flexShrink: 0 }}>
        {open ? "▾" : "▸"}
      </span>
    </button>
  );
}

function HoldingSymbolLink({ symbol }: { symbol: string }) {
  const { colors } = useTheme();
  return (
    <Link
      href={portfolioHoldingDeepDiveHref(symbol)}
      data-testid={`review-deep-dive-${symbol}`}
      onClick={(e) => e.stopPropagation()}
      style={{ color: colors.accent, textDecoration: "none", fontWeight: 700 }}
    >
      {symbol}
    </Link>
  );
}

function ReviewDetail({ h }: { h: HoldingReview }) {
  const { colors } = useTheme();
  const extra = remainingRationale(h);
  const muted: React.CSSProperties = { fontSize: typography.scale.xs, color: colors.textMuted };
  return (
    <div
      data-testid={`review-row-detail-${h.symbol}`}
      style={{ display: "flex", flexDirection: "column", gap: spacing[1] }}
    >
      <Link
        href={portfolioHoldingDeepDiveHref(h.symbol)}
        data-testid={`review-detail-deep-dive-${h.symbol}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          fontSize: typography.scale.xs,
          fontWeight: 600,
          color: colors.accent,
          textDecoration: "none",
          width: "fit-content"
        }}
      >
        Open Long Term deep dive
      </Link>
      {h.isFundVehicle ? (
        <div data-testid={`vehicle-honesty-${h.symbol}`} style={muted}>
          Fund/ETF vehicle — no corporate filings; F1–F5 do not apply.
        </div>
      ) : null}
      {extra.length > 0 ? (
        <div style={muted}>{extra.join(" ")}</div>
      ) : null}
      {h.taxLotHint ? <div style={muted}>{h.taxLotHint}</div> : null}
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
        <div
          data-testid={`ai-read-${h.symbol}`}
          style={{ fontSize: typography.scale.sm, color: colors.text, marginTop: spacing[1] }}
        >
          {h.aiRead}
        </div>
      ) : null}
    </div>
  );
}

function ReviewTableRow({ h }: { h: HoldingReview }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const plColor =
    h.unrealizedPlPct == null
      ? colors.text
      : h.unrealizedPlPct >= 0
        ? colors.bullish
        : colors.bearish;

  return (
    <>
      <tr
        data-testid={`review-row-${h.symbol}`}
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: "pointer" }}
      >
        <td style={tdStyle(colors, "left", { fontWeight: 700, whiteSpace: "nowrap" })}>
          <HoldingSymbolLink symbol={h.symbol} />
        </td>
        <td style={tdStyle(colors, "left")}>
          <ActionBadge h={h} />
        </td>
        <td style={tdStyle(colors, "right", { color: plColor, whiteSpace: "nowrap" })}>
          {fmtPct(h.unrealizedPlPct)} vs cost
        </td>
        <td style={tdStyle(colors, "right", { whiteSpace: "nowrap" })}>
          {h.weightPct != null ? `${h.weightPct.toFixed(1)}%` : "—"}
        </td>
        <td style={tdStyle(colors, "right")}>
          <DoThisCell h={h} />
        </td>
        <td style={tdStyle(colors, "left", { whiteSpace: "normal", maxWidth: 320 })}>
          <WhyToggle h={h} open={open} onToggle={() => setOpen((v) => !v)} />
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} style={tdStyle(colors, "left", { borderTop: "none", paddingTop: 0 })}>
            <ReviewDetail h={h} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ReviewCard({ h }: { h: HoldingReview }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const plColor =
    h.unrealizedPlPct == null
      ? colors.textMuted
      : h.unrealizedPlPct >= 0
        ? colors.bullish
        : colors.bearish;

  return (
    <div
      data-testid={`review-row-${h.symbol}`}
      onClick={() => setOpen((v) => !v)}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        padding: spacing[3],
        display: "flex",
        flexDirection: "column",
        gap: spacing[1],
        cursor: "pointer"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2] }}>
        <HoldingSymbolLink symbol={h.symbol} />
        <ActionBadge h={h} />
      </div>
      <div style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
        <DoThisCell h={h} />
        <span style={{ color: colors.textMuted }}> · </span>
        <span style={{ color: plColor }}>{fmtPct(h.unrealizedPlPct)} vs cost</span>
        <span>
          {" "}
          · {h.weightPct != null ? `${h.weightPct.toFixed(1)}%` : "—"}
        </span>
      </div>
      <WhyToggle h={h} open={open} onToggle={() => setOpen((v) => !v)} />
      {open ? <ReviewDetail h={h} /> : null}
    </div>
  );
}
