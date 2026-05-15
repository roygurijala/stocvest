"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobileLayout } from "@/lib/hooks/use-is-mobile-layout";
import { useTheme } from "@/lib/theme-provider";

const DEFAULT_MAX_WIDTH_PX = 260;
const VIEW_MARGIN = 8;
const GAP_PX = 8;

/** Tooltips store emphasis as markdown `**` in source; strip for plain UI text. */
function tipBodyDisplay(raw: string): string {
  return raw.replace(/\*\*([^*]+)\*\*/g, "$1");
}

export function InfoTip({ text, label, maxWidth }: { text: string; label?: string; maxWidth?: number }) {
  const maxW = maxWidth ?? DEFAULT_MAX_WIDTH_PX;
  const { colors } = useTheme();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const isMobile = useIsMobileLayout();
  const displayText = tipBodyDisplay(text);

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

    let tipW = maxW;
    let tipH = 72;
    if (tip) {
      const tr = tip.getBoundingClientRect();
      tipW = Math.min(maxW, tr.width > 0 ? tr.width : maxW);
      tipH = tr.height > 0 ? tr.height : 72;
    }

    let left = rect.left + rect.width / 2 - tipW / 2;
    left = Math.max(VIEW_MARGIN, Math.min(left, vw - tipW - VIEW_MARGIN));

    const spaceAbove = rect.top - VIEW_MARGIN;
    const spaceBelow = vh - rect.bottom - VIEW_MARGIN;
    const preferAbove = spaceAbove >= tipH + GAP_PX || spaceAbove >= spaceBelow;

    let top: number;
    if (preferAbove) {
      top = rect.top - GAP_PX - tipH;
      if (top < VIEW_MARGIN) {
        top = rect.bottom + GAP_PX;
      }
    } else {
      top = rect.bottom + GAP_PX;
      if (top + tipH > vh - VIEW_MARGIN) {
        top = rect.top - GAP_PX - tipH;
      }
    }

    if (top < VIEW_MARGIN) top = VIEW_MARGIN;
    if (top + tipH > vh - VIEW_MARGIN) {
      top = Math.max(VIEW_MARGIN, vh - VIEW_MARGIN - tipH);
    }

    setCoords({ left, top });
  }, [maxW]);

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
  }, [open, mounted, placeTooltip, displayText, maxW]);

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

  const active = hover || focused;
  const iconBorderIdle = `color-mix(in srgb, ${colors.textMuted} 72%, ${colors.border})`;
  const iconBorderActive = `color-mix(in srgb, ${colors.bullish} 55%, ${colors.border})`;
  const borderColor = active ? iconBorderActive : iconBorderIdle;
  const fg = active ? colors.bullish : colors.textMuted;

  const showTooltip = mounted && open;

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
        maxWidth: maxW,
        zIndex: 9999,
        background: `linear-gradient(180deg, color-mix(in srgb, ${colors.surfaceMuted} 96%, ${colors.border}) 0%, ${colors.surfaceMuted} 100%)`,
        color: colors.text,
        border: `1px solid color-mix(in srgb, ${colors.border} 88%, transparent)`,
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 12,
        lineHeight: 1.55,
        whiteSpace: "pre-line",
        boxShadow: `0 10px 30px color-mix(in srgb, #000 45%, transparent), 0 0 0 1px color-mix(in srgb, ${colors.text} 6%, transparent)`,
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
              color: colors.textMuted,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: 0
            }}
          >
            ×
          </button>
          {displayText}
        </div>
      ) : (
        displayText
      )}
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label ?? "More information"}
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
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
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center border-0 bg-transparent p-0 leading-none md:min-h-[22px] md:min-w-[22px]"
        style={{ cursor: "pointer" }}
      >
        <span
          className="inline-flex items-center justify-center font-semibold transition-[color,border-color,box-shadow] duration-150 ease-out"
          style={{
            width: 15,
            height: 15,
            borderRadius: "50%",
            border: `1px solid ${borderColor}`,
            background: active ? `color-mix(in srgb, ${colors.bullish} 14%, transparent)` : `color-mix(in srgb, ${colors.textMuted} 10%, transparent)`,
            color: fg,
            fontSize: 9,
            lineHeight: 1,
            boxShadow: active ? `0 0 0 2px color-mix(in srgb, ${colors.bullish} 22%, transparent)` : "none"
          }}
        >
          i
        </span>
      </button>
      {tooltip ? createPortal(tooltip, document.body) : null}
    </>
  );
}
