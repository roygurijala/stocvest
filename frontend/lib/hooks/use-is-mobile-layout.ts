"use client";

import { useEffect, useState } from "react";
import { PAGE_STACK_MAX_PX } from "@/lib/layout-breakpoints";

/** True when viewport is below Tailwind `lg` (1024px) — mobile / tablet drawer layout. */
export function useIsMobileLayout(): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${PAGE_STACK_MAX_PX}px)`);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return mobile;
}
