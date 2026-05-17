"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobileLayout } from "@/lib/hooks/use-is-mobile-layout";
import { SCENARIO_DETAIL_CHIP_CLASS } from "@/lib/watchlist-interactive-styles";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  label: string;
  tip: string;
  ariaLabel?: string;
  testId?: string;
  maxWidth?: number;
};

export function ScenarioDetailChip({ label, tip, ariaLabel, testId, maxWidth = 280 }: Props) {
  const { colors } = useTheme();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const isMobile = useIsMobileLayout();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState({ left: 0, top: 0 });
  const [tipReady, setTipReady] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  const placeTooltip = useCallback(() => {
    const trigger = triggerRef.current;
    const tipEl = tooltipRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let tipW = maxWidth;
    let tipH = 80;
    if (tipEl) {
      const tr = tipEl.getBoundingClientRect();
      tipW = Math.min(maxWidth, tr.width > 0 ? tr.width : maxWidth);
      tipH = tr.height > 0 ? tr.height : 80;
    }
    let left = rect.left;
    left = Math.max(8, Math.min(left, vw - tipW - 8));
    let top = rect.bottom + 8;
    if (top + tipH > vh - 8) top = rect.top - 8 - tipH;
    if (top < 8) top = 8;
    setCoords({ left, top });
  }, [maxWidth]);

  useLayoutEffect(() => {
    if (!open || !mounted) {
      setTipReady(false);
      return;
    }
    setTipReady(false);
    placeTooltip();
    const raf = requestAnimationFrame(() => {
      placeTooltip();
      setTipReady(true);
    });
    const onReposition = () => placeTooltip();
    window.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open, mounted, placeTooltip, tip]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (tooltipRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [open]);

  const popup =
    mounted && open ? (
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        className={isMobile ? "shadow-xl" : "pointer-events-none shadow-xl"}
        style={{
          position: "fixed",
          left: coords.left,
          top: coords.top,
          maxWidth,
          zIndex: 9999,
          background: colors.surfaceMuted,
          color: colors.text,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: "10px 14px",
          fontSize: 12,
          lineHeight: 1.55,
          whiteSpace: "pre-line",
          opacity: tipReady ? 1 : 0,
          transition: "opacity 150ms ease"
        }}
      >
        {isMobile ? (
          <div style={{ position: "relative", paddingRight: 28 }}>
            <button
              type="button"
              aria-label="Close"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                border: "none",
                background: "transparent",
                color: colors.textMuted,
                cursor: "pointer",
                fontSize: 18
              }}
            >
              ×
            </button>
            {tip}
          </div>
        ) : (
          tip
        )}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={SCENARIO_DETAIL_CHIP_CLASS}
        data-testid={testId}
        aria-label={ariaLabel ?? label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onMouseEnter={() => {
          if (!isMobile) setOpen(true);
        }}
        onMouseLeave={() => {
          if (!isMobile) setOpen(false);
        }}
      >
        {label}
      </button>
      {popup ? createPortal(popup, document.body) : null}
    </>
  );
}
