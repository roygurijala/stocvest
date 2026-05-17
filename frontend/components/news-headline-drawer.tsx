"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";
import { ExternalLink, X } from "lucide-react";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { NewsIntelCategory, NewsPayload } from "@/lib/api/market";

function drawerCategory(article: NewsPayload): NewsIntelCategory {
  if (article.category) return article.category;
  const c = article.catalyst_category;
  if (c === "ma") return "merger";
  if (c === "fda" || c === "sector") return "sector";
  if (c === "earnings" || c === "analyst" || c === "macro" || c === "general") return c;
  return "general";
}

type NewsHeadlineDrawerProps = {
  open: boolean;
  article: NewsPayload | null;
  onClose: () => void;
};

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function nonEmpty(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
}

/** Badge next to source/time: Bullish / Bearish / Mixed (amber). Uses `sentiment` or infers from `sentiment_score`. */
function sentimentBadge(article: NewsPayload): { label: string; tone: "bullish" | "bearish" | "mixed" } | null {
  const raw = (article.sentiment ?? "").trim().toLowerCase();
  if (raw === "bullish" || raw === "positive") {
    return { label: "Bullish", tone: "bullish" };
  }
  if (raw === "bearish" || raw === "negative") {
    return { label: "Bearish", tone: "bearish" };
  }
  if (raw === "mixed" || raw === "neutral") {
    return { label: raw === "neutral" ? "Neutral" : "Mixed", tone: "mixed" };
  }
  const sc = article.sentiment_score;
  if (typeof sc === "number" && Number.isFinite(sc)) {
    if (sc > 0.15) return { label: "Bullish", tone: "bullish" };
    if (sc < -0.15) return { label: "Bearish", tone: "bearish" };
    return { label: "Mixed", tone: "mixed" };
  }
  return null;
}

export function NewsHeadlineDrawer({ open, article, onClose }: NewsHeadlineDrawerProps) {
  const { colors } = useTheme();

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !article || typeof document === "undefined") {
    return null;
  }

  const description = nonEmpty(article.description);
  const imageUrl = nonEmpty(article.image_url);
  const intelCat = drawerCategory(article);
  const badge = sentimentBadge(article);
  const badgeBg =
    badge?.tone === "bullish"
      ? "rgba(34,197,94,0.18)"
      : badge?.tone === "bearish"
        ? "rgba(239,68,68,0.18)"
        : "rgba(245,158,11,0.2)";
  const badgeColor =
    badge?.tone === "bullish" ? colors.bullish : badge?.tone === "bearish" ? colors.bearish : colors.caution;
  const badgeBorder =
    badge?.tone === "bullish"
      ? "rgba(34,197,94,0.45)"
      : badge?.tone === "bearish"
        ? "rgba(239,68,68,0.45)"
        : "rgba(245,158,11,0.45)";

  return createPortal(
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1250,
        display: "flex",
        justifyContent: "flex-end",
        background: "rgba(0,0,0,0.45)"
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-headline-drawer-title news-headline-drawer-article-title"
        className={surfaceGlowClassName}
        style={{
          width: "min(440px, 100vw)",
          height: "100%",
          background: colors.surface,
          borderLeft: `1px solid ${colors.border}`,
          boxShadow: "-8px 0 32px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          animation: "stocvest-news-drawer-in 0.24s ease-out"
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <style>{`@keyframes stocvest-news-drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: spacing[2],
            padding: spacing[3],
            borderBottom: `1px solid ${colors.border}`,
            flexShrink: 0
          }}
        >
          <p id="news-headline-drawer-title" style={{ margin: 0, fontSize: typography.scale.xs, fontWeight: 700, color: colors.textMuted }}>
            Headline
          </p>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: colors.textMuted,
              cursor: "pointer",
              padding: spacing[1],
              borderRadius: borderRadius.md,
              display: "inline-flex"
            }}
          >
            <X size={20} />
          </button>
        </div>
        <div
          style={{
            flex: "0 1 auto",
            minHeight: 0,
            maxHeight: "calc(100dvh - 200px)",
            overflowY: "auto",
            padding: spacing[4],
            display: "flex",
            flexDirection: "column",
            gap: spacing[3]
          }}
        >
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote Polygon CDN URL
            <img
              src={imageUrl}
              alt=""
              style={{
                width: "100%",
                maxHeight: 200,
                objectFit: "cover",
                borderRadius: 8,
                marginBottom: 0,
                display: "block"
              }}
            />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2" style={{ rowGap: spacing[2] }}>
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs, flex: "1 1 auto" }}>
              <span style={{ marginRight: 6 }} aria-hidden>
                {intelCat === "earnings"
                  ? "📊"
                  : intelCat === "analyst"
                    ? "🏦"
                    : intelCat === "breaking"
                      ? "🔴"
                      : intelCat === "macro"
                        ? "🌍"
                        : intelCat === "merger"
                          ? "🤝"
                          : intelCat === "sector"
                            ? "⚙️"
                            : "📰"}
              </span>
              {(article.source || "News").trim()} · {timeAgo(article.published_at)}
            </p>
            {badge ? (
              <span
                style={{
                  flexShrink: 0,
                  borderRadius: borderRadius.full,
                  padding: "4px 10px",
                  fontSize: typography.scale.xs,
                  fontWeight: 700,
                  background: badgeBg,
                  color: badgeColor,
                  border: `1px solid ${badgeBorder}`
                }}
              >
                {badge.label}
              </span>
            ) : null}
          </div>
          {article.credibility?.label || typeof article.relevance_score === "number" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2], alignItems: "center" }}>
              {article.credibility?.label ? (
                <span
                  style={{
                    borderRadius: borderRadius.full,
                    padding: "4px 10px",
                    fontSize: typography.scale.xs,
                    fontWeight: 700,
                    border: `1px solid ${colors.border}`,
                    background: colors.surfaceMuted,
                    color: colors.text
                  }}
                >
                  {article.credibility.label}
                </span>
              ) : null}
              {typeof article.relevance_score === "number" ? (
                <span style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>
                  Relevance score {article.relevance_score}/100
                </span>
              ) : null}
            </div>
          ) : null}
          <h2
            id="news-headline-drawer-article-title"
            style={{ margin: 0, fontSize: typography.scale.lg, lineHeight: 1.35, color: colors.text, fontWeight: 700 }}
          >
            {article.title}
          </h2>
          {article.tickers?.length ? (
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              Tickers:{" "}
              <span style={{ color: colors.text, fontWeight: 600 }}>{article.tickers.join(", ")}</span>
            </p>
          ) : null}
          {description ? (
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.7,
                color: "var(--color-text-secondary)",
                margin: 0,
                marginTop: spacing[1],
                paddingTop: spacing[3],
                borderTop: `1px solid ${colors.border}`
              }}
            >
              {description}
            </p>
          ) : null}
        </div>
        <div
          style={{
            padding: spacing[3],
            borderTop: `1px solid ${colors.border}`,
            display: "flex",
            flexDirection: "column",
            gap: spacing[2],
            flexShrink: 0,
            marginTop: "auto"
          }}
        >
          <a
            href={article.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md font-semibold"
            style={{
              background: colors.accent,
              color: "#fff",
              textDecoration: "none",
              fontSize: typography.scale.sm
            }}
          >
            <ExternalLink size={18} aria-hidden />
            Open original article
          </a>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 w-full rounded-md"
            style={{
              border: `1px solid ${colors.border}`,
              background: "transparent",
              color: colors.textMuted,
              cursor: "pointer",
              fontSize: typography.scale.sm
            }}
          >
            Close
          </button>
        </div>
      </aside>
    </div>,
    document.body
  );
}
