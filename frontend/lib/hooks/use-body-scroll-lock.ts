"use client";

import { useEffect } from "react";

import { lockBodyScroll } from "@/lib/body-scroll-lock";

/** Reference-counted body scroll lock while `active` is true (modals / drawers). */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return lockBodyScroll();
  }, [active]);
}
