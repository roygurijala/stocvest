"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MAX_WIDTH_PX = 260;
const VIEW_MARGIN = 8;
const GAP_PX = 8;

export function InfoTip({ text, label }: { text: string; label?: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
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

    let tipW = MAX_WIDTH_PX;
    let tipH = 72;
    if (tip) {
      const tr = tip.getBoundingClientRect();
      tipW = Math.min(MAX_WIDTH_PX, tr.width > 0 ? tr.width : MAX_WIDTH_PX);
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
  }, []);

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
  }, [open, mounted, placeTooltip, text]);

  const active = hover || focused;
  const borderColor = active ? "#3b82f6" : "#6b7280";
  const fg = active ? "#3b82f6" : "#6b7280";

  const tooltip =
    mounted && open ? (
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none rounded-md bg-[#0f172a] px-3 py-2 text-xs leading-relaxed text-white shadow-xl transition-opacity duration-150"
        style={{
          position: "fixed",
          left: coords.left,
          top: coords.top,
          maxWidth: MAX_WIDTH_PX,
          zIndex: 9999,
          opacity: tipReady ? 1 : 0,
          transition: "opacity 120ms ease"
        }}
      >
        {text}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label ?? "More information"}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => {
          setHover(true);
          setOpen(true);
        }}
        onMouseLeave={() => {
          setHover(false);
          setOpen(false);
        }}
        onFocus={() => {
          setFocused(true);
          setOpen(true);
        }}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
        }}
        className="inline-flex shrink-0 items-center justify-center p-0 leading-none transition-colors"
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: `1px solid ${borderColor}`,
          background: "transparent",
          color: fg,
          cursor: active ? "pointer" : "default",
          fontSize: 10,
          fontWeight: 700
        }}
      >
        i
      </button>
      {tooltip ? createPortal(tooltip, document.body) : null}
    </>
  );
}
