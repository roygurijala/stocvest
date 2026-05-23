"use client";

import { useEffect } from "react";

import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";

/** Scroll lock + Escape-to-dismiss for modal overlays. */
export function useModalOverlay(active: boolean, onClose?: () => void, lockScroll = true): void {
  useBodyScrollLock(active && lockScroll);

  useEffect(() => {
    if (!active || !onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}
