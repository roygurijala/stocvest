"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { resetBodyScrollLock } from "@/lib/body-scroll-lock";

/** Clears stuck ``body { overflow: hidden }`` after client navigations. */
export function BodyScrollResetOnNavigate() {
  const pathname = usePathname();
  useEffect(() => {
    resetBodyScrollLock();
  }, [pathname]);
  return null;
}
