"use client";

import { useEffect, type ReactNode } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string | null;
  accent?: string;
  colors: ThemeColors;
  children: ReactNode;
};

export function ScannerTerminalDetailSheet({ open, onClose, title, accent, colors, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="scanner-terminal-detail-sheet"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end"
      }}
    >
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          background: "rgba(0,0,0,.55)",
          cursor: "pointer"
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "relative",
          maxHeight: "78vh",
          overflow: "auto",
          background: colors.surface,
          borderTopLeftRadius: borderRadius.xl,
          borderTopRightRadius: borderRadius.xl,
          border: `1px solid ${colors.border}`,
          boxShadow: "0 -16px 48px rgba(0,0,0,.45)"
        }}
      >
        <div
          style={{
            height: 3,
            background: accent ?? colors.accent,
            borderTopLeftRadius: borderRadius.xl,
            borderTopRightRadius: borderRadius.xl
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: `${spacing[2]} ${spacing[4]} 0`,
            gap: spacing[2]
          }}
        >
          <div
            aria-hidden
            style={{
              width: 44,
              height: 4,
              borderRadius: 999,
              background: colors.border
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `${spacing[2]} ${spacing[4]}`,
            borderBottom: `1px solid ${colors.border}`
          }}
        >
          <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}>
            {title ?? "Symbol detail"}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.sm,
              background: colors.surfaceMuted ?? colors.surface,
              color: colors.textMuted,
              fontSize: typography.scale.xs,
              fontWeight: 600,
              padding: `${spacing[1]} ${spacing[2]}`,
              cursor: "pointer"
            }}
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
