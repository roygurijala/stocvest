"use client";

import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { GapIntelligenceCatalyst } from "@/lib/api/scanner";

export type GapNewsDrawerPayload = {
  symbol: string;
  catalyst: GapIntelligenceCatalyst;
};

type GapCatalystNewsDrawerProps = {
  open: boolean;
  payload: GapNewsDrawerPayload | null;
  onClose: () => void;
  onViewSignal: () => void;
};

function formatPublished(iso: string | undefined): string {
  if (!iso || !iso.trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

export function GapCatalystNewsDrawer({ open, payload, onClose, onViewSignal }: GapCatalystNewsDrawerProps) {
  const { colors } = useTheme();

  useBodyScrollLock(open);

  if (!open || !payload || typeof document === "undefined") {
    return null;
  }

  const { symbol, catalyst } = payload;
  const source = (catalyst.source || "").trim() || "News";
  const when = formatPublished(catalyst.published_at);
  const body = (catalyst.article_description || "").trim() || "No article summary available for this item.";

  return createPortal(
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
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
        aria-labelledby="gap-news-drawer-title"
        className={surfaceGlowClassName}
        style={{
          width: "min(440px, 100vw)",
          height: "100%",
          background: colors.surface,
          borderLeft: `1px solid ${colors.border}`,
          boxShadow: "-8px 0 32px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          animation: "stocvest-drawer-in 0.22s ease-out"
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <style>{`@keyframes stocvest-drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: spacing[2],
            padding: spacing[3],
            borderBottom: `1px solid ${colors.border}`
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, fontWeight: 600 }}>{symbol}</p>
            <h2 id="gap-news-drawer-title" style={{ margin: spacing[1] + " 0 0", fontSize: typography.scale.lg, lineHeight: 1.3 }}>
              {catalyst.headline}
            </h2>
            <p style={{ margin: spacing[2] + " 0 0", fontSize: typography.scale.xs, color: colors.textMuted }}>
              {source}
              {when ? ` · ${when}` : ""}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.md,
              background: colors.surfaceMuted,
              color: colors.text,
              padding: 8,
              cursor: "pointer",
              flexShrink: 0
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: spacing[3] }}>
          <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: typography.scale.sm, lineHeight: 1.55, color: colors.text }}>
            {body}
          </p>
        </div>
        <div
          style={{
            padding: spacing[3],
            borderTop: `1px solid ${colors.border}`,
            display: "flex",
            flexDirection: "column",
            gap: spacing[2]
          }}
        >
          <button
            type="button"
            onClick={() => {
              onClose();
              onViewSignal();
            }}
            style={{
              width: "100%",
              padding: `${spacing[2]} ${spacing[3]}`,
              borderRadius: borderRadius.md,
              border: "none",
              fontWeight: 700,
              cursor: "pointer",
              background: colors.accent,
              color: "#fff"
            }}
          >
            View Signal
          </button>
        </div>
      </aside>
    </div>,
    document.body
  );
}
