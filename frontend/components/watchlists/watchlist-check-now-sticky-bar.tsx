"use client";

import { APP_TOP_BAR_LAYOUT_HEIGHT } from "@/components/top-bar";
import { spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** Number of symbols in the Check now tier. */
  count: number;
  /** Element marking the bottom edge of the Check now section (IntersectionObserver target). */
  sentinelRef: RefObject<HTMLElement | null>;
};

export function WatchlistCheckNowStickyBar({ count, sentinelRef }: Props) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (count <= 0) {
      setVisible(false);
      return;
    }
    const el = sentinelRef.current;
    if (!el || typeof window === "undefined" || !("IntersectionObserver" in window)) return;

    observerRef.current?.disconnect();
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setVisible(!entry.isIntersecting);
      },
      { root: null, rootMargin: `-${APP_TOP_BAR_LAYOUT_HEIGHT} 0px 0px 0px`, threshold: 0 }
    );
    observer.observe(el);
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [count, sentinelRef]);

  if (count <= 0 || !visible || typeof document === "undefined") return null;

  return createPortal(
    <button
      type="button"
      className="fixed left-1/2 z-40 flex max-w-lg -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-lg transition hover:brightness-105"
      style={{
        top: `calc(${APP_TOP_BAR_LAYOUT_HEIGHT} + ${spacing[2]})`,
        background: colors.surface,
        borderColor: colors.bullish,
        color: colors.text,
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)"
      }}
      data-testid="watchlist-check-now-sticky-bar"
      onClick={() => {
        document.getElementById("watchlist-tier-check_now")?.scrollIntoView({
          block: "start",
          behavior: "smooth"
        });
      }}
    >
      <span aria-hidden>🔥</span>
      <span>
        Check now ({count}) — jump back
      </span>
    </button>,
    document.body
  );
}
