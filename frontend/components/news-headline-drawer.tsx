"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { NewsPayload } from "@/lib/api/market";

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

export function NewsHeadlineDrawer({ open, article, onClose }: NewsHeadlineDrawerProps) {
  const { colors } = useTheme();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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

  const sentimentLabel =
    article.sentiment && article.sentiment.trim()
      ? article.sentiment.trim()
      : article.sentiment_score != null && Number.isFinite(article.sentiment_score)
        ? `Score ${article.sentiment_score > 0 ? "+" : ""}${article.sentiment_score.toFixed(2)}`
        : null;

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
        aria-labelledby="news-headline-drawer-title"
        className={surfaceGlowClassName}
        style={{
          width: "min(440px, 100vw)",
          height: "100%",
          background: colors.surface,
          borderLeft: `1px solid ${colors.border}`,
          boxShadow: "-8px 0 32px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
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
        <div style={{ flex: 1, overflowY: "auto", padding: spacing[4], display: "grid", gap: spacing[3] }}>
          <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.xs }}>
            {(article.source || "News").trim()} · {timeAgo(article.published_at)}
          </p>
          <h2 style={{ margin: 0, fontSize: typography.scale.lg, lineHeight: 1.35, color: colors.text, fontWeight: 700 }}>
            {article.title}
          </h2>
          {sentimentLabel ? (
            <span
              style={{
                justifySelf: "start",
                borderRadius: borderRadius.full,
                padding: "4px 10px",
                fontSize: typography.scale.xs,
                fontWeight: 600,
                background: "rgba(59,130,246,0.12)",
                color: colors.accent
              }}
            >
              {sentimentLabel}
            </span>
          ) : null}
          {article.tickers?.length ? (
            <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted }}>
              Tickers:{" "}
              <span style={{ color: colors.text, fontWeight: 600 }}>{article.tickers.join(", ")}</span>
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
            flexShrink: 0
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
