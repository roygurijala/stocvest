"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobileLayout } from "@/lib/hooks/use-is-mobile-layout";

const VIEW_MARGIN = 8;
const GAP_PX = 8;
const TIP_BG = "#1e293b";
const TIP_BORDER = "#334155";

type DecisionMetricProps = {
  /** Plain English: how this value feeds scanner / composite / your workflow. */
  explanation: string;
  children: React.ReactNode;
  /** Accessible label for the trigger. */
  label?: string;
  maxWidth?: number;
};

/**
 * Wraps a numeric (or short) display with a dotted underline; hover / focus / tap shows how the value is used in decision-making.
 */
export function DecisionMetric({ explanation, children, label = "How this number is used", maxWidth = 280 }: DecisionMetricProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const isMobile = useIsMobileLayout();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [tipReady, setTipReady] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  const placeTooltip = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tooltipRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let tipW = maxWidth;
    let tipH = 80;
    if (tip) {
      const tr = tip.getBoundingClientRect();
      tipW = Math.min(maxWidth, tr.width > 0 ? tr.width : maxWidth);
      tipH = tr.height > 0 ? tr.height : 80;
    }
    let left = rect.left + rect.width / 2 - tipW / 2;
    left = Math.max(VIEW_MARGIN, Math.min(left, vw - tipW - VIEW_MARGIN));
    const spaceAbove = rect.top - VIEW_MARGIN;
    const spaceBelow = vh - rect.bottom - VIEW_MARGIN;
    const preferAbove = spaceAbove >= tipH + GAP_PX || spaceAbove >= spaceBelow;
    let top: number;
    if (preferAbove) {
      top = rect.top - GAP_PX - tipH;
      if (top < VIEW_MARGIN) top = rect.bottom + GAP_PX;
    } else {
      top = rect.bottom + GAP_PX;
      if (top + tipH > vh - VIEW_MARGIN) top = rect.top - GAP_PX - tipH;
    }
    if (top < VIEW_MARGIN) top = VIEW_MARGIN;
    if (top + tipH > vh - VIEW_MARGIN) top = Math.max(VIEW_MARGIN, vh - VIEW_MARGIN - tipH);
    setCoords({ left, top });
  }, [maxWidth]);

  const active = hover || focused;
  const showTooltip = mounted && open;

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
  }, [open, mounted, placeTooltip, explanation]);

  useEffect(() => {
    if (!isMobile || !open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (tooltipRef.current?.contains(t)) return;
      setOpen(false);
      setHover(false);
      setFocused(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [isMobile, open]);

  const tooltip = showTooltip ? (
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
        background: TIP_BG,
        color: "#ffffff",
        border: `1px solid ${TIP_BORDER}`,
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
        lineHeight: 1.5,
        opacity: tipReady ? 1 : 0,
        transition: "opacity 150ms ease"
      }}
    >
      {isMobile ? (
        <div style={{ position: "relative", paddingRight: 28 }}>
          <button
            type="button"
            aria-label="Close tooltip"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              setHover(false);
              setFocused(false);
            }}
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              width: 28,
              height: 28,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "transparent",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: 0
            }}
          >
            ×
          </button>
          {explanation}
        </div>
      ) : (
        explanation
      )}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        className="group inline border-0 bg-transparent p-0 leading-none"
        style={{
          cursor: "help",
          borderBottom: active ? "1px dashed rgba(59,130,246,0.85)" : "1px dashed rgba(148,163,184,0.45)",
          color: "inherit",
          textDecoration: "none",
          maxWidth: "100%",
          font: "inherit"
        }}
        onMouseEnter={() => {
          if (isMobile) return;
          setHover(true);
          setOpen(true);
        }}
        onMouseLeave={() => {
          if (isMobile) return;
          setHover(false);
          setOpen(false);
        }}
        onFocus={() => {
          if (isMobile) return;
          setFocused(true);
          setOpen(true);
        }}
        onBlur={() => {
          if (isMobile) return;
          setFocused(false);
          setOpen(false);
        }}
        onClick={(e) => {
          if (!isMobile) return;
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {children}
      </button>
      {tooltip ? createPortal(tooltip, document.body) : null}
    </>
  );
}
